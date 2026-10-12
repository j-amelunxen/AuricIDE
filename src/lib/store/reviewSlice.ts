import type { StateCreator } from 'zustand';

import { riskFlagsForPatch } from '../git/review/riskFlags';
import {
  diffTargetOf,
  orderReviewFiles,
  patchHash,
  reviewTabId,
  viewedMarksKey,
  type ReviewFile,
  type ReviewFileStatus,
  type ReviewSource,
  type ViewedMarks,
} from '../git/review/reviewSession';
import {
  getGitDiff,
  getGitDiffFileRef,
  getGitDiffRefFiles,
  getGitStatus,
  type GitStatusLabel,
} from '../tauri/git';

export interface ReviewSession {
  source: ReviewSource;
  /** Already in review order (`orderReviewFiles`). */
  files: ReviewFile[];
  loading: boolean;
  /** Listing the change set failed. Per-file failures sit on the file (`loadError`). */
  error: string | null;
}

export interface ReviewSlice {
  /** Keyed by `reviewTabId(source)`. */
  reviewSessions: Record<string, ReviewSession>;
  /** `viewedMarksKey(source)` → filePath → hash of the patch that was viewed. Persisted per project. */
  viewedMarks: Record<string, ViewedMarks>;
  /** Opens (or refreshes, when already open) a session and returns its tab id at once. */
  openReviewSession: (source: ReviewSource) => string;
  refreshReviewSession: (tabId: string) => Promise<void>;
  /**
   * Reads one file's patch again, in place: after a hunk action only that file
   * changed, and re-reading a 200-file change set for it would be the slow
   * path. A file with no patch left leaves the session.
   */
  refreshReviewFile: (tabId: string, path: string) => Promise<void>;
  /** Marks the file's current version viewed, or clears the mark when exactly that version is marked. */
  toggleViewed: (tabId: string, path: string) => void;
  closeReviewSession: (tabId: string) => void;
  /** Drops every session (project switch). Viewed marks stay: persistence scopes them per project. */
  resetReviewInMemory: () => void;
}

// ── Selectors (zustand v5: never return a fresh [] or {}) ──────────

const NO_FILES: ReviewFile[] = [];
const NO_MARKS: ViewedMarks = {};

export function selectReviewSession(
  state: Pick<ReviewSlice, 'reviewSessions'>,
  tabId: string
): ReviewSession | undefined {
  return state.reviewSessions[tabId];
}

export function selectReviewFiles(
  state: Pick<ReviewSlice, 'reviewSessions'>,
  tabId: string
): ReviewFile[] {
  return state.reviewSessions[tabId]?.files ?? NO_FILES;
}

export function selectViewedMarks(
  state: Pick<ReviewSlice, 'viewedMarks'>,
  marksKey: string | null
): ViewedMarks {
  return (marksKey && state.viewedMarks[marksKey]) || NO_MARKS;
}

// ── Loading ────────────────────────────────────────────────────────

interface ListedFile {
  path: string;
  status: ReviewFileStatus;
}

/** Patches are read a few at a time: one IPC call per file, and a change set can be large. */
const DIFF_CONCURRENCY = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reviewStatusOf(label: GitStatusLabel): ReviewFileStatus | null {
  return label === 'ignored' ? null : label;
}

async function listFiles(source: ReviewSource): Promise<ListedFile[]> {
  if (source.kind === 'ref') {
    const files = await getGitDiffRefFiles(source.repoPath, diffTargetOf(source));
    return files.map((file) => ({ path: file.path, status: file.status }));
  }
  const statuses = await getGitStatus(source.repoPath);
  return statuses.flatMap((entry) => {
    const status = reviewStatusOf(entry.status);
    return status ? [{ path: entry.path, status }] : [];
  });
}

function readPatch(source: ReviewSource, path: string): Promise<string> {
  return source.kind === 'ref'
    ? getGitDiffFileRef(source.repoPath, diffTargetOf(source), path)
    : // No side: the combined HEAD → work tree patch, staged and unstaged together.
      getGitDiff(source.repoPath, path);
}

async function loadFile(source: ReviewSource, listed: ListedFile): Promise<ReviewFile> {
  // The merge panel owns conflicted files; a diff of marker text would only mislead.
  if (listed.status === 'conflicted') {
    return { ...listed, patch: '', flags: [], hash: patchHash('') };
  }
  try {
    const patch = await readPatch(source, listed.path);
    return {
      ...listed,
      patch,
      flags: riskFlagsForPatch(listed.path, patch),
      hash: patchHash(patch),
    };
  } catch (error) {
    return { ...listed, patch: '', flags: [], hash: patchHash(''), loadError: errorMessage(error) };
  }
}

async function loadFiles(source: ReviewSource, listed: ListedFile[]): Promise<ReviewFile[]> {
  const loaded: ReviewFile[] = new Array(listed.length);
  let next = 0;
  async function worker() {
    while (next < listed.length) {
      const index = next++;
      loaded[index] = await loadFile(source, listed[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DIFF_CONCURRENCY, listed.length) }, worker));
  return orderReviewFiles(loaded);
}

/**
 * Files that read back exactly as before keep their object, so the sections
 * showing them do not render again when a refresh finds nothing new there.
 */
function keepUnchanged(previous: ReviewFile[], next: ReviewFile[]): ReviewFile[] {
  if (previous.length === 0) return next;
  const old = new Map(previous.map((f) => [f.path, f]));
  return next.map((file) => {
    const before = old.get(file.path);
    return before &&
      before.hash === file.hash &&
      before.status === file.status &&
      before.patch === file.patch &&
      before.loadError === file.loadError
      ? before
      : file;
  });
}

/** Latest load per tab; a load that finishes after a newer one started is dropped. */
const latestLoad = new Map<string, number>();
let loadCounter = 0;

export const createReviewSlice: StateCreator<ReviewSlice> = (set, get) => {
  function patchSession(tabId: string, token: number, patch: Partial<ReviewSession>) {
    if (latestLoad.get(tabId) !== token) return;
    set((s) => {
      const session = s.reviewSessions[tabId];
      if (!session) return s;
      return { reviewSessions: { ...s.reviewSessions, [tabId]: { ...session, ...patch } } };
    });
  }

  return {
    reviewSessions: {},
    viewedMarks: {},

    openReviewSession: (source) => {
      const tabId = reviewTabId(source);
      // An open session takes the new source too: a re-open may carry a newer merge base.
      set((s) => {
        const existing = s.reviewSessions[tabId];
        return {
          reviewSessions: {
            ...s.reviewSessions,
            [tabId]: existing
              ? { ...existing, source }
              : { source, files: [], loading: true, error: null },
          },
        };
      });
      void get().refreshReviewSession(tabId);
      return tabId;
    },

    refreshReviewSession: async (tabId) => {
      const session = get().reviewSessions[tabId];
      if (!session) return;
      const token = ++loadCounter;
      latestLoad.set(tabId, token);
      patchSession(tabId, token, { loading: true, error: null });
      try {
        const listed = await listFiles(session.source);
        const files = keepUnchanged(
          get().reviewSessions[tabId]?.files ?? [],
          await loadFiles(session.source, listed)
        );
        patchSession(tabId, token, { files, loading: false, error: null });
      } catch (error) {
        patchSession(tabId, token, { loading: false, error: errorMessage(error) });
      }
    },

    refreshReviewFile: async (tabId, path) => {
      const session = get().reviewSessions[tabId];
      const listed = session?.files.find((f) => f.path === path);
      if (!session || !listed) return;
      const file = await loadFile(session.source, { path, status: listed.status });
      set((s) => {
        const current = s.reviewSessions[tabId];
        if (!current) return s;
        const gone = !file.loadError && !file.patch.trim() && file.status !== 'conflicted';
        const files = gone
          ? current.files.filter((f) => f.path !== path)
          : current.files.map((f) => (f.path === path ? file : f));
        return { reviewSessions: { ...s.reviewSessions, [tabId]: { ...current, files } } };
      });
    },

    toggleViewed: (tabId, path) => {
      const session = get().reviewSessions[tabId];
      const file = session?.files.find((f) => f.path === path);
      if (!session || !file) return;
      const key = viewedMarksKey(session.source);
      set((s) => {
        const marks = { ...(s.viewedMarks[key] ?? {}) };
        if (marks[path] === file.hash) delete marks[path];
        else marks[path] = file.hash;
        return { viewedMarks: { ...s.viewedMarks, [key]: marks } };
      });
    },

    closeReviewSession: (tabId) => {
      latestLoad.delete(tabId);
      set((s) => {
        if (!s.reviewSessions[tabId]) return s;
        const next = { ...s.reviewSessions };
        delete next[tabId];
        return { reviewSessions: next };
      });
    },

    resetReviewInMemory: () => {
      for (const tabId of Object.keys(get().reviewSessions)) latestLoad.delete(tabId);
      set({ reviewSessions: {} });
    },
  };
};
