import type { StateCreator } from 'zustand';
import type { DiffTabState } from '../git/diffTab';
import { isStaged, isUnstagedTracked, isUntracked } from '../git/statusSplit';
import type {
  BlameHunk,
  BranchInfo,
  CommitInfo,
  GitBranch,
  GitFileStatus,
  GitNameStatus,
} from '../tauri/git';
import {
  getBranchInfo,
  commitChanges,
  pushChanges,
  stageFiles,
  getGitStatus,
  unstageFiles,
  gitLogSince,
  listGitBranches,
  getGitDiffRefFiles,
  gitBlame,
} from '../tauri/git';

export type ScmView = 'changes' | 'history' | 'compare';
export type HunkNavDirection = 'next' | 'prev';

export interface GitSlice {
  branchInfo: BranchInfo | null;
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  isPushing: boolean;
  diffByTabId: Record<string, DiffTabState>;
  scmView: ScmView;
  setScmView: (view: ScmView) => void;
  historyPath: string | null;
  historyCommits: CommitInfo[];
  historySelectedOid: string | null;
  historyLoading: boolean;
  loadFileHistory: (repoPath: string, filePath: string) => Promise<void>;
  setHistorySelectedOid: (oid: string | null) => void;
  branches: GitBranch[];
  compareRef: string | null;
  compareFiles: GitNameStatus[];
  compareLoading: boolean;
  loadBranches: (repoPath: string) => Promise<void>;
  loadCompare: (repoPath: string, ref: string) => Promise<void>;
  blameVisible: boolean;
  blameByPath: Record<string, BlameHunk[]>;
  blameLoading: boolean;
  toggleBlame: () => void;
  loadBlame: (repoPath: string, filePath: string) => Promise<void>;
  hunkNavNonce: number;
  hunkNavDirection: HunkNavDirection | null;
  requestHunkNav: (dir: HunkNavDirection) => void;
  setDiffTab: (tabId: string, state: DiffTabState) => void;
  clearDiffTab: (tabId: string) => void;
  resetGitInMemory: () => void;
  refreshGitStatus: (repoPath: string) => Promise<void>;
  stageFile: (repoPath: string, path: string) => Promise<void>;
  /** Stages every changed file except the ignored ones, in one round trip. */
  stageAll: (repoPath: string) => Promise<void>;
  unstageFile: (repoPath: string, path: string) => Promise<void>;
  unstageAll: (repoPath: string) => Promise<void>;
  commit: (repoPath: string) => Promise<string | null>;
  /** Pushes the current branch to origin. Rethrows so the caller can report. */
  push: (repoPath: string) => Promise<void>;
  setCommitMessage: (msg: string) => void;
}

/**
 * One array for every file that has no blame yet.
 *
 * `useStore` runs its selector on every snapshot check and compares the result
 * by identity, so a selector that builds its own empty array reports a changed
 * store on each pass — the component re-renders, the selector answers with
 * another new array, and React stops the loop by throwing. Sharing one instance
 * is what keeps "no blame loaded" a stable answer.
 */
const NO_BLAME_HUNKS: BlameHunk[] = [];

/** Blame for the file behind a tab, addressed by its absolute path. */
export function selectBlameHunks(
  state: { rootPath: string | null; blameByPath: Record<string, BlameHunk[]> },
  filePath: string | undefined
): BlameHunk[] {
  if (!state.rootPath || !filePath) return NO_BLAME_HUNKS;
  const relativePath = filePath.startsWith(`${state.rootPath}/`)
    ? filePath.slice(state.rootPath.length + 1)
    : filePath;
  return state.blameByPath[relativePath] ?? NO_BLAME_HUNKS;
}

const EMPTY_REVIEW_STATE = {
  scmView: 'changes' as const,
  historyPath: null,
  historyCommits: [] as CommitInfo[],
  historySelectedOid: null,
  historyLoading: false,
  branches: [] as GitBranch[],
  compareRef: null,
  compareFiles: [] as GitNameStatus[],
  compareLoading: false,
  blameVisible: false,
  blameByPath: {} as Record<string, BlameHunk[]>,
  blameLoading: false,
  hunkNavNonce: 0,
  hunkNavDirection: null,
};

export const createGitSlice: StateCreator<GitSlice> = (set, get) => ({
  branchInfo: null,
  fileStatuses: [],
  commitMessage: '',
  isCommitting: false,
  isPushing: false,
  diffByTabId: {},
  ...EMPTY_REVIEW_STATE,

  setScmView: (view) => set({ scmView: view }),

  loadFileHistory: async (repoPath, filePath) => {
    set({ historyPath: filePath, historyLoading: true, historySelectedOid: null });
    try {
      const historyCommits = await gitLogSince(repoPath, undefined, filePath);
      set({ historyCommits, historyLoading: false });
    } catch {
      set({ historyCommits: [], historyLoading: false });
    }
  },

  setHistorySelectedOid: (oid) => set({ historySelectedOid: oid }),

  loadBranches: async (repoPath) => {
    const branches = await listGitBranches(repoPath);
    set({ branches });
  },

  loadCompare: async (repoPath, ref) => {
    set({ compareRef: ref, compareLoading: true });
    try {
      const compareFiles = await getGitDiffRefFiles(repoPath, ref);
      set({ compareFiles, compareLoading: false });
    } catch {
      set({ compareFiles: [], compareLoading: false });
    }
  },

  toggleBlame: () => set((s) => ({ blameVisible: !s.blameVisible })),

  loadBlame: async (repoPath, filePath) => {
    set({ blameLoading: true });
    try {
      const hunks = await gitBlame(repoPath, filePath);
      set((s) => ({
        blameByPath: { ...s.blameByPath, [filePath]: hunks },
        blameLoading: false,
      }));
    } catch {
      set((s) => ({
        blameByPath: { ...s.blameByPath, [filePath]: [] },
        blameLoading: false,
      }));
    }
  },

  requestHunkNav: (dir) =>
    set((s) => ({ hunkNavNonce: s.hunkNavNonce + 1, hunkNavDirection: dir })),

  setDiffTab: (tabId, state) => set((s) => ({ diffByTabId: { ...s.diffByTabId, [tabId]: state } })),

  clearDiffTab: (tabId) =>
    set((s) => {
      if (!(tabId in s.diffByTabId)) return s;
      const next = { ...s.diffByTabId };
      delete next[tabId];
      return { diffByTabId: next };
    }),

  resetGitInMemory: () => set({ diffByTabId: {}, ...EMPTY_REVIEW_STATE }),

  refreshGitStatus: async (repoPath) => {
    const [statuses, branch] = await Promise.all([getGitStatus(repoPath), getBranchInfo(repoPath)]);
    set({ fileStatuses: statuses, branchInfo: branch });
  },

  stageFile: async (repoPath, path) => {
    await stageFiles(repoPath, [path]);
    await get().refreshGitStatus(repoPath);
  },

  stageAll: async (repoPath) => {
    // Only the unstaged side — already-fully-staged files stay out, deletions stay in.
    const paths = get()
      .fileStatuses.filter(
        (s) => s.status !== 'ignored' && (isUnstagedTracked(s) || isUntracked(s))
      )
      .map((s) => s.path);
    if (paths.length === 0) return;
    await stageFiles(repoPath, paths);
    await get().refreshGitStatus(repoPath);
  },

  unstageFile: async (repoPath, path) => {
    await unstageFiles(repoPath, [path]);
    await get().refreshGitStatus(repoPath);
  },

  unstageAll: async (repoPath) => {
    const paths = get()
      .fileStatuses.filter(isStaged)
      .map((s) => s.path);
    if (paths.length === 0) return;
    await unstageFiles(repoPath, paths);
    await get().refreshGitStatus(repoPath);
  },

  commit: async (repoPath) => {
    const { commitMessage, fileStatuses } = get();
    if (!commitMessage.trim()) return null;

    set({ isCommitting: true });
    try {
      if (!fileStatuses.some(isStaged)) {
        await get().stageAll(repoPath);
      }
      const oid = await commitChanges(repoPath, commitMessage);
      set({ commitMessage: '' });
      await get().refreshGitStatus(repoPath);
      return oid;
    } finally {
      set({ isCommitting: false });
    }
  },

  push: async (repoPath) => {
    set({ isPushing: true });
    try {
      await pushChanges(repoPath);
      // The branch's ahead/behind display is what a push changes.
      await get().refreshGitStatus(repoPath);
    } finally {
      set({ isPushing: false });
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),
});
