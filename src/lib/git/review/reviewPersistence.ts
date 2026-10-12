/**
 * Viewed marks and review comments survive a restart
 * (`docs/design-merge-panel.md`, review requirements 2 and 6).
 *
 * Both name repository paths, so they belong to the project, not to the
 * machine: they live in the project's own `kv_store` (`.auric/project.db`,
 * namespace `review_state`), next to `projectConfig`. A project stores the
 * state of the repos at or below its root and of its agent worktrees, which
 * sit beside the root in `<root>.auric-wt/` (`agentWorktree.ts`).
 */
import { dbGet, dbSet } from '@/lib/tauri/db';
import { AURIC_WORKTREE_DIR_SUFFIX } from '../agentWorktree';
import type { ReviewComment } from '../reviewComments';
import { migrateMarksKey, repoOfMarksKey, type ViewedMarks } from './reviewSession';

export const REVIEW_STATE_NAMESPACE = 'review_state';
const MARKS_KEY = 'viewed_marks';
const COMMENTS_KEY = 'comments';

export const SAVE_DEBOUNCE_MS = 500;

export interface ReviewPersistedState {
  viewedMarks: Record<string, ViewedMarks>;
  reviewComments: ReviewComment[];
}

export function belongsToProject(repoPath: string, rootPath: string): boolean {
  return (
    repoPath === rootPath ||
    repoPath.startsWith(`${rootPath}/`) ||
    repoPath.startsWith(`${rootPath}${AURIC_WORKTREE_DIR_SUFFIX}/`)
  );
}

function scopeToProject(state: ReviewPersistedState, rootPath: string): ReviewPersistedState {
  const viewedMarks: Record<string, ViewedMarks> = {};
  for (const [key, marks] of Object.entries(state.viewedMarks)) {
    if (belongsToProject(repoOfMarksKey(key), rootPath)) viewedMarks[key] = marks;
  }
  return {
    viewedMarks,
    reviewComments: state.reviewComments.filter((c) => belongsToProject(c.repoPath, rootPath)),
  };
}

// ── Parsing (what is on disk was written by an older or a hand-edited build) ──

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMarks(raw: string | null): Record<string, ViewedMarks> {
  const value = parseJson(raw);
  if (!isRecord(value)) return {};
  const result: Record<string, ViewedMarks> = {};
  for (const [storedKey, marks] of Object.entries(value)) {
    if (!isRecord(marks)) continue;
    const key = migrateMarksKey(storedKey);
    const clean: ViewedMarks = {};
    for (const [filePath, hash] of Object.entries(marks)) {
      if (typeof hash === 'string') clean[filePath] = hash;
    }
    result[key] = { ...result[key], ...clean };
  }
  return result;
}

function isComment(value: unknown): value is ReviewComment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.repoPath === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.lineNo === 'number' &&
    (value.side === 'new' || value.side === 'old') &&
    typeof value.lineContent === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.sentInRound === undefined || typeof value.sentInRound === 'number')
  );
}

function parseComments(raw: string | null): ReviewComment[] {
  const value = parseJson(raw);
  return Array.isArray(value) ? value.filter(isComment) : [];
}

// ── Load / save ────────────────────────────────────────────────────

/**
 * The stored state of one project, scoped to it. Nothing stored and corrupt
 * values come back empty. A failing database is thrown, not swallowed: an
 * empty result would let the next save overwrite what is really there.
 */
export async function loadReviewState(rootPath: string): Promise<ReviewPersistedState> {
  const [marks, comments] = await Promise.all([
    dbGet(rootPath, REVIEW_STATE_NAMESPACE, MARKS_KEY),
    dbGet(rootPath, REVIEW_STATE_NAMESPACE, COMMENTS_KEY),
  ]);
  return scopeToProject(
    { viewedMarks: parseMarks(marks), reviewComments: parseComments(comments) },
    rootPath
  );
}

/** Writes the part of `state` that belongs to the project at `rootPath`. */
export async function saveReviewState(
  rootPath: string,
  state: ReviewPersistedState
): Promise<void> {
  const scoped = scopeToProject(state, rootPath);
  await Promise.all([
    dbSet(rootPath, REVIEW_STATE_NAMESPACE, MARKS_KEY, JSON.stringify(scoped.viewedMarks)),
    dbSet(rootPath, REVIEW_STATE_NAMESPACE, COMMENTS_KEY, JSON.stringify(scoped.reviewComments)),
  ]);
}

/** Stored and in-memory state together; on a clash, memory wins (it is newer). */
function merge(stored: ReviewPersistedState, current: ReviewPersistedState): ReviewPersistedState {
  const viewedMarks = { ...current.viewedMarks };
  for (const [repoPath, marks] of Object.entries(stored.viewedMarks)) {
    viewedMarks[repoPath] = { ...marks, ...current.viewedMarks[repoPath] };
  }
  const known = new Set(current.reviewComments.map((c) => c.id));
  return {
    viewedMarks,
    reviewComments: [
      ...stored.reviewComments.filter((c) => !known.has(c.id)),
      ...current.reviewComments,
    ],
  };
}

// ── Store binding ──────────────────────────────────────────────────

/** The slice of a zustand store this needs; the app store (`useStore`) fits it. */
export interface ReviewPersistenceStore {
  getState(): ReviewPersistedState;
  setState(partial: Partial<ReviewPersistedState>): void;
  subscribe(
    listener: (state: ReviewPersistedState, previous: ReviewPersistedState) => void
  ): () => void;
}

/**
 * Keeps `viewedMarks` and `reviewComments` in the open project's database.
 *
 * - When the project changes it loads that project's state and merges it into
 *   the store. No write happens for a project before its load has finished,
 *   and none at all if the load failed, so a stored state is never replaced
 *   by an empty one.
 * - Changes are written once they have been quiet for `SAVE_DEBOUNCE_MS`.
 * - A write still pending when the project changes is dropped, not flushed:
 *   opening another folder clears the in-memory comments before it switches
 *   the root, and flushing that would wipe the previous project. The cost is
 *   an edit made in the last half second before a switch.
 * - The returned function unsubscribes and flushes a pending write.
 *
 * Wire it once at app boot, next to the other store subscribers:
 *
 * ```ts
 * const stop = subscribeReviewPersistence(useStore, () => useStore.getState().rootPath);
 * ```
 */
export function subscribeReviewPersistence(
  store: ReviewPersistenceStore,
  getRootPath: () => string | null
): () => void {
  let currentRoot: string | null = null;
  let hydratedRoot: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function cancelPending() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function write(root: string) {
    saveReviewState(root, store.getState()).catch((error: unknown) => {
      console.warn('[review] could not save review state', error);
    });
  }

  function schedule() {
    const root = currentRoot;
    if (root === null || root !== hydratedRoot) return;
    cancelPending();
    timer = setTimeout(() => {
      timer = null;
      if (currentRoot === root) write(root);
    }, SAVE_DEBOUNCE_MS);
  }

  function hydrate(root: string) {
    loadReviewState(root).then(
      (stored) => {
        if (stopped || currentRoot !== root) return;
        hydratedRoot = root;
        store.setState(merge(stored, store.getState()));
      },
      (error: unknown) => {
        console.warn('[review] could not load review state; not saving for this project', error);
      }
    );
  }

  function syncRoot() {
    const root = getRootPath();
    if (root === currentRoot) return;
    cancelPending();
    currentRoot = root;
    hydratedRoot = null;
    if (root) hydrate(root);
  }

  const unsubscribe = store.subscribe((state, previous) => {
    syncRoot();
    if (
      state.viewedMarks !== previous.viewedMarks ||
      state.reviewComments !== previous.reviewComments
    ) {
      schedule();
    }
  });
  syncRoot();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null && currentRoot !== null && currentRoot === hydratedRoot) {
      cancelPending();
      write(currentRoot);
    }
    cancelPending();
  };
}
