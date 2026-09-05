import type { DiffTabState } from '../../git/diffTab';
import type { ReviewComment } from '../../git/reviewComments';
import type {
  BlameHunk,
  BranchInfo,
  CommitInfo,
  GitBranch,
  GitFileStatus,
  GitNameStatus,
  GitRepoRef,
  GitWorktree,
  WorktreeMergeResult,
} from '../../tauri/git';

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
  /**
   * Bumped when nested-repo ignores change so Quick Access re-probes dirty
   * flags. Discovery already hid the repo in Source Control; the splash tiles
   * would otherwise keep the old amber pip until the window was hidden.
   */
  projectDirtyEpoch: number;
  bumpProjectDirtyEpoch: () => void;
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
  /** `main` or `master` for this repo. Throws if neither exists. */
  defaultBranchFor: (repoPath: string) => Promise<string>;
  /**
   * Merge an Auric worktree into the repo's default branch, then remove it.
   * Uncommitted worktree files are committed first.
   */
  mergeAgentWorktree: (
    worktreePath: string,
    commitMessage?: string
  ) => Promise<WorktreeMergeResult>;
}

export const EMPTY_REVIEW_STATE = {
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
