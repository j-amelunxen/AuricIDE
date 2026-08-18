import type { StateCreator } from 'zustand';
import type { DiffTabState } from '../git/diffTab';
import { reviewCommentId, type ReviewComment } from '../git/reviewComments';
import { repoForPath } from '../git/repos';
import { isStaged, isUnstagedTracked, isUntracked } from '../git/statusSplit';
import type {
  BlameHunk,
  BranchInfo,
  CommitInfo,
  GitBranch,
  GitFileStatus,
  GitNameStatus,
  GitRepoRef,
  GitWorktree,
} from '../tauri/git';
import {
  discoverGitRepos,
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
  listGitWorktrees,
  removeGitWorktree,
} from '../tauri/git';

export type ScmView = 'changes' | 'history' | 'compare';
export type HunkNavDirection = 'next' | 'prev';

/** One repo's own status + commit-box state, keyed by `repoPath` in `repoStates`. */
export interface GitRepoState {
  ref: GitRepoRef;
  branchInfo: BranchInfo | null;
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  isPushing: boolean;
}

export interface GitSlice {
  repos: GitRepoRef[];
  repoStates: Record<string, GitRepoState>;
  /** History / Compare target; first discovered repo by default. */
  activeRepoPath: string | null;
  setActiveRepoPath: (repoPath: string | null) => void;
  /** Discovers repos under rootPath, then refreshes every repo's status + branch. */
  discoverAndRefreshGit: (rootPath: string) => Promise<void>;
  /** Status + branch for every known repo (no rediscovery). */
  refreshGitStatus: () => Promise<void>;
  /** One repo only — after a stage/commit in that repo. */
  refreshRepoStatus: (repoPath: string) => Promise<void>;
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
  /** Keyed by absolute file path (`${repoPath}/${relativeFilePath}`). */
  blameByPath: Record<string, BlameHunk[]>;
  blameLoading: boolean;
  toggleBlame: () => void;
  loadBlame: (repoPath: string, filePath: string) => Promise<void>;
  hunkNavNonce: number;
  hunkNavDirection: HunkNavDirection | null;
  requestHunkNav: (dir: HunkNavDirection) => void;
  setDiffTab: (tabId: string, state: DiffTabState) => void;
  clearDiffTab: (tabId: string) => void;
  reviewComments: ReviewComment[];
  upsertReviewComment: (comment: Omit<ReviewComment, 'id' | 'createdAt'>) => string;
  removeReviewComment: (id: string) => void;
  clearReviewComments: (repoPath?: string) => void;
  resetGitInMemory: () => void;
  stageFile: (repoPath: string, path: string) => Promise<void>;
  /** Stages every changed file except the ignored ones, in one round trip. */
  stageAll: (repoPath: string) => Promise<void>;
  unstageFile: (repoPath: string, path: string) => Promise<void>;
  unstageAll: (repoPath: string) => Promise<void>;
  commit: (repoPath: string) => Promise<string | null>;
  /** Pushes the current branch to origin. Rethrows so the caller can report. */
  push: (repoPath: string) => Promise<void>;
  setCommitMessage: (repoPath: string, msg: string) => void;
  /** Auric-managed worktrees across every discovered repo. */
  agentWorktrees: GitWorktree[];
  refreshAgentWorktrees: () => Promise<void>;
  removeAgentWorktree: (worktreePath: string, force: boolean) => Promise<void>;
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
  state: { blameByPath: Record<string, BlameHunk[]> },
  filePath: string | undefined
): BlameHunk[] {
  if (!filePath) return NO_BLAME_HUNKS;
  return state.blameByPath[filePath] ?? NO_BLAME_HUNKS;
}

export function selectRepoState(
  state: { repoStates: Record<string, GitRepoState> },
  repoPath: string
): GitRepoState | undefined {
  return state.repoStates[repoPath];
}

export function selectRepoForPath(
  state: { repos: GitRepoRef[] },
  absPath: string
): GitRepoRef | null {
  return repoForPath(absPath, state.repos);
}

/** All repos, ignored excluded — the sidebar badge. */
export function selectChangedFileCount(state: {
  repoStates: Record<string, GitRepoState>;
}): number {
  let count = 0;
  for (const repoState of Object.values(state.repoStates)) {
    for (const status of repoState.fileStatuses) {
      if (status.status !== 'ignored') count += 1;
    }
  }
  return count;
}

/** The path's own repo, else the root repo, else the first repo, else null. */
export function selectBranchNameForPath(
  state: { repos: GitRepoRef[]; repoStates: Record<string, GitRepoState> },
  absPath: string | null
): string | null {
  const repoOfPath = absPath ? repoForPath(absPath, state.repos) : null;
  const rootRepo = state.repos.find((r) => r.kind === 'root') ?? null;
  const repo = repoOfPath ?? rootRepo ?? state.repos[0] ?? null;
  if (!repo) return null;
  return state.repoStates[repo.path]?.branchInfo?.name ?? null;
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
  reviewComments: [] as ReviewComment[],
};

/** Merges a fetched status into `states`, keeping that repo's commit-box UI state untouched. */
function applyRepoStatus(
  states: Record<string, GitRepoState>,
  ref: GitRepoRef,
  fileStatuses: GitFileStatus[],
  branchInfo: BranchInfo | null
): Record<string, GitRepoState> {
  const prev = states[ref.path];
  return {
    ...states,
    [ref.path]: {
      ref,
      branchInfo,
      fileStatuses,
      commitMessage: prev?.commitMessage ?? '',
      isCommitting: prev?.isCommitting ?? false,
      isPushing: prev?.isPushing ?? false,
    },
  };
}

/** Drops any repoStates entry whose repo is no longer among the discovered ones. */
function pruneRepoStates(
  states: Record<string, GitRepoState>,
  repos: readonly GitRepoRef[]
): Record<string, GitRepoState> {
  const discoveredPaths = new Set(repos.map((r) => r.path));
  const pruned: Record<string, GitRepoState> = {};
  let changed = false;
  for (const [path, repoState] of Object.entries(states)) {
    if (discoveredPaths.has(path)) {
      pruned[path] = repoState;
    } else {
      changed = true;
    }
  }
  return changed ? pruned : states;
}

/**
 * Fields to merge when the active repo changes. History and compare are a
 * view into one repo's log/refs — carrying them past a repo switch would
 * label the previous repo's commits as the new repo's. When `nextActive`
 * equals `currentActive` (survives a rediscovery, or a redundant call), that
 * state is left alone entirely: no fields beyond `activeRepoPath` are
 * returned, so `set()` doesn't touch — or churn a re-render over — anything
 * that didn't actually change. Blame and diff tabs are untouched either way;
 * they're already keyed per file/repo.
 */
function activeRepoChangeFields(
  currentActive: string | null,
  nextActive: string | null
): Pick<GitSlice, 'activeRepoPath'> &
  Partial<
    Pick<
      GitSlice,
      | 'historyPath'
      | 'historyCommits'
      | 'historySelectedOid'
      | 'historyLoading'
      | 'branches'
      | 'compareRef'
      | 'compareFiles'
      | 'compareLoading'
    >
  > {
  if (currentActive === nextActive) {
    return { activeRepoPath: nextActive };
  }
  return {
    activeRepoPath: nextActive,
    historyPath: null,
    historyCommits: [],
    historySelectedOid: null,
    historyLoading: false,
    branches: [],
    compareRef: null,
    compareFiles: [],
    compareLoading: false,
  };
}

/**
 * Seeds a placeholder `GitRepoState` for every discovered repo that doesn't
 * have one yet, keeping existing entries as-is.
 *
 * `discoverAndRefreshGit` writes `repos` immediately but the status IPC for
 * each repo is still in flight for a moment after — without a seeded entry,
 * `setRepoField` (which `setCommitMessage` etc. go through) finds nothing to
 * merge into and silently no-ops, so a keystroke typed into a freshly
 * discovered repo's commit box during that window is dropped on the floor.
 */
function seedRepoStates(
  states: Record<string, GitRepoState>,
  repos: readonly GitRepoRef[]
): Record<string, GitRepoState> {
  const missing = repos.filter((ref) => !states[ref.path]);
  if (missing.length === 0) return states;
  const seeded = { ...states };
  for (const ref of missing) {
    seeded[ref.path] = {
      ref,
      branchInfo: null,
      fileStatuses: [],
      commitMessage: '',
      isCommitting: false,
      isPushing: false,
    };
  }
  return seeded;
}

/**
 * Drops blame entries whose owning repo is gone.
 *
 * A blame key is just an absolute path — it doesn't say which repo it came
 * from. Checking "is this path under any currently discovered repo" isn't
 * enough to answer that: in the common root-plus-nested-service layout the
 * root repo's path prefixes every nested repo's files too, so a file whose
 * *own* (nested) repo just vanished would still read as "under the root
 * repo" and never get pruned. Resolving the deepest match against the repos
 * as they were *before* this rediscovery recovers which repo actually owned
 * the path, so pruning can check that specific repo, not just any ancestor.
 */
function pruneBlameByPath(
  blameByPath: Record<string, BlameHunk[]>,
  previousRepos: readonly GitRepoRef[],
  repos: readonly GitRepoRef[]
): Record<string, BlameHunk[]> {
  const discoveredPaths = new Set(repos.map((r) => r.path));
  const pruned: Record<string, BlameHunk[]> = {};
  let changed = false;
  for (const [absPath, hunks] of Object.entries(blameByPath)) {
    const owningRepo = repoForPath(absPath, previousRepos);
    const stillTracked = owningRepo !== null && discoveredPaths.has(owningRepo.path);
    if (stillTracked) {
      pruned[absPath] = hunks;
    } else {
      changed = true;
    }
  }
  return changed ? pruned : blameByPath;
}

function setRepoField(
  states: Record<string, GitRepoState>,
  repoPath: string,
  patch: Partial<GitRepoState>
): Record<string, GitRepoState> {
  const existing = states[repoPath];
  if (!existing) return states;
  return { ...states, [repoPath]: { ...existing, ...patch } };
}

async function fetchRepoStatus(
  repoPath: string
): Promise<{ fileStatuses: GitFileStatus[]; branchInfo: BranchInfo | null }> {
  const [fileStatuses, branchInfo] = await Promise.all([
    getGitStatus(repoPath),
    getBranchInfo(repoPath),
  ]);
  return { fileStatuses, branchInfo };
}

/** Settles independently — one repo's failure keeps `[]`/`null` without dropping the others. */
async function fetchRepoStatusResilient(
  repoPath: string
): Promise<{ fileStatuses: GitFileStatus[]; branchInfo: BranchInfo | null }> {
  try {
    return await fetchRepoStatus(repoPath);
  } catch {
    return { fileStatuses: [], branchInfo: null };
  }
}

export const createGitSlice: StateCreator<GitSlice> = (set, get) => {
  /**
   * Writes a fetched status back only if `ref` is still a discovered repo.
   *
   * A repo's status fetch is in flight for the whole `await` — long enough for
   * a second, faster `discoverAndRefreshGit` call to prune that repo out from
   * under it. Without this check the first call's late-arriving write would
   * resurrect a repoStates entry for a repo that no longer exists.
   */
  const writeRepoStatus = (
    ref: GitRepoRef,
    fileStatuses: GitFileStatus[],
    branchInfo: BranchInfo | null
  ) => {
    if (!get().repos.some((r) => r.path === ref.path)) return;
    set((s) => ({ repoStates: applyRepoStatus(s.repoStates, ref, fileStatuses, branchInfo) }));
  };

  return {
    repos: [],
    repoStates: {},
    activeRepoPath: null,
    diffByTabId: {},
    agentWorktrees: [],
    ...EMPTY_REVIEW_STATE,

    setActiveRepoPath: (repoPath) => {
      const current = get().activeRepoPath;
      if (current === repoPath) return;
      set(activeRepoChangeFields(current, repoPath));
    },

    discoverAndRefreshGit: async (rootPath) => {
      let repos: GitRepoRef[];
      try {
        repos = await discoverGitRepos(rootPath);
      } catch {
        repos = [];
      }

      const currentActive = get().activeRepoPath;
      const activeRepoPath =
        currentActive && repos.some((r) => r.path === currentActive)
          ? currentActive
          : (repos[0]?.path ?? null);

      set((s) => ({
        repos,
        repoStates: seedRepoStates(pruneRepoStates(s.repoStates, repos), repos),
        blameByPath: pruneBlameByPath(s.blameByPath, s.repos, repos),
        ...activeRepoChangeFields(currentActive, activeRepoPath),
      }));

      await Promise.all(
        repos.map(async (ref) => {
          const { fileStatuses, branchInfo } = await fetchRepoStatusResilient(ref.path);
          writeRepoStatus(ref, fileStatuses, branchInfo);
        })
      );
      await get().refreshAgentWorktrees();
    },

    refreshGitStatus: async () => {
      const { repos } = get();
      await Promise.all(
        repos.map(async (ref) => {
          const { fileStatuses, branchInfo } = await fetchRepoStatusResilient(ref.path);
          writeRepoStatus(ref, fileStatuses, branchInfo);
        })
      );
      await get().refreshAgentWorktrees();
    },

    refreshRepoStatus: async (repoPath) => {
      const ref = get().repos.find((r) => r.path === repoPath);
      if (!ref) return;
      const { fileStatuses, branchInfo } = await fetchRepoStatus(repoPath);
      writeRepoStatus(ref, fileStatuses, branchInfo);
    },

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
      const key = `${repoPath}/${filePath}`;
      set({ blameLoading: true });
      try {
        const hunks = await gitBlame(repoPath, filePath);
        set((s) => ({
          blameByPath: { ...s.blameByPath, [key]: hunks },
          blameLoading: false,
        }));
      } catch {
        set((s) => ({
          blameByPath: { ...s.blameByPath, [key]: [] },
          blameLoading: false,
        }));
      }
    },

    requestHunkNav: (dir) =>
      set((s) => ({ hunkNavNonce: s.hunkNavNonce + 1, hunkNavDirection: dir })),

    setDiffTab: (tabId, state) =>
      set((s) => ({ diffByTabId: { ...s.diffByTabId, [tabId]: state } })),

    clearDiffTab: (tabId) =>
      set((s) => {
        if (!(tabId in s.diffByTabId)) return s;
        const next = { ...s.diffByTabId };
        delete next[tabId];
        return { diffByTabId: next };
      }),

    upsertReviewComment: (comment) => {
      const id = reviewCommentId(comment);
      const body = comment.body.trim();
      set((s) => {
        const without = s.reviewComments.filter((c) => c.id !== id);
        if (!body) return { reviewComments: without };
        const existing = s.reviewComments.find((c) => c.id === id);
        const next: ReviewComment = {
          ...comment,
          id,
          body,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        return { reviewComments: [...without, next] };
      });
      return id;
    },

    removeReviewComment: (id) =>
      set((s) => ({ reviewComments: s.reviewComments.filter((c) => c.id !== id) })),

    clearReviewComments: (repoPath) =>
      set((s) => ({
        reviewComments: repoPath ? s.reviewComments.filter((c) => c.repoPath !== repoPath) : [],
      })),

    resetGitInMemory: () =>
      set({
        diffByTabId: {},
        repos: [],
        repoStates: {},
        activeRepoPath: null,
        agentWorktrees: [],
        ...EMPTY_REVIEW_STATE,
      }),

    refreshAgentWorktrees: async () => {
      const { repos } = get();
      const listed = await Promise.all(
        repos.map(async (ref) => {
          try {
            return await listGitWorktrees(ref.path);
          } catch {
            return [] as GitWorktree[];
          }
        })
      );
      const seen = new Set<string>();
      const agentWorktrees: GitWorktree[] = [];
      for (const tree of listed.flat()) {
        if (seen.has(tree.path)) continue;
        seen.add(tree.path);
        agentWorktrees.push(tree);
      }
      agentWorktrees.sort((a, b) => a.name.localeCompare(b.name));
      set({ agentWorktrees });
    },

    removeAgentWorktree: async (worktreePath, force) => {
      const tree = get().agentWorktrees.find((wt) => wt.path === worktreePath);
      const repoPath = tree?.sourceRepo;
      if (!repoPath) {
        throw new Error('worktree not found');
      }
      await removeGitWorktree(repoPath, worktreePath, force);
      await get().refreshAgentWorktrees();
    },

    stageFile: async (repoPath, path) => {
      await stageFiles(repoPath, [path]);
      await get().refreshRepoStatus(repoPath);
    },

    stageAll: async (repoPath) => {
      // Only the unstaged side — already-fully-staged files stay out, deletions stay in.
      const paths = (get().repoStates[repoPath]?.fileStatuses ?? [])
        .filter((s) => s.status !== 'ignored' && (isUnstagedTracked(s) || isUntracked(s)))
        .map((s) => s.path);
      if (paths.length === 0) return;
      await stageFiles(repoPath, paths);
      await get().refreshRepoStatus(repoPath);
    },

    unstageFile: async (repoPath, path) => {
      await unstageFiles(repoPath, [path]);
      await get().refreshRepoStatus(repoPath);
    },

    unstageAll: async (repoPath) => {
      const paths = (get().repoStates[repoPath]?.fileStatuses ?? [])
        .filter(isStaged)
        .map((s) => s.path);
      if (paths.length === 0) return;
      await unstageFiles(repoPath, paths);
      await get().refreshRepoStatus(repoPath);
    },

    commit: async (repoPath) => {
      const repoState = get().repoStates[repoPath];
      const commitMessage = repoState?.commitMessage ?? '';
      if (!commitMessage.trim()) return null;

      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isCommitting: true }) }));
      try {
        if (!(repoState?.fileStatuses ?? []).some(isStaged)) {
          await get().stageAll(repoPath);
        }
        const oid = await commitChanges(repoPath, commitMessage);
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { commitMessage: '' }) }));
        await get().refreshRepoStatus(repoPath);
        return oid;
      } finally {
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isCommitting: false }) }));
      }
    },

    push: async (repoPath) => {
      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isPushing: true }) }));
      try {
        await pushChanges(repoPath);
        // The branch's ahead/behind display is what a push changes.
        await get().refreshRepoStatus(repoPath);
      } finally {
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isPushing: false }) }));
      }
    },

    setCommitMessage: (repoPath, msg) =>
      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { commitMessage: msg }) })),
  };
};
