import { invoke } from './invoke';

/** Mirrors `GitMergeState` in `src-tauri/src/git/merge.rs`. See `docs/design-merge-panel.md`. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'none' | 'other';

export type GitConflictKind =
  'content' | 'both-added' | 'deleted-by-us' | 'deleted-by-them' | 'binary' | 'symlink';

export interface GitConflictEntry {
  /** Repo-relative, `/`-separated. */
  path: string;
  kind: GitConflictKind;
}

export interface GitMergeState {
  inProgress: boolean;
  operation: GitOperation;
  /** HEAD's branch shorthand, or a short oid when detached. `null` when unborn. */
  oursLabel: string | null;
  /** Branch named in MERGE_MSG, else the short MERGE_HEAD oid. */
  theirsLabel: string | null;
  theirsOid: string | null;
  /** MERGE_MSG without comment lines. */
  message: string | null;
  /** Sorted by path. */
  conflicts: GitConflictEntry[];
  /** Which commit a rebase is replaying; absent or `null` outside a rebase. */
  step?: GitOperationStep | null;
  /** HEAD's full oid; `null` when unborn. */
  headOid?: string | null;
  /**
   * The commit a rebase, cherry-pick or revert is applying (`REBASE_HEAD`,
   * `CHERRY_PICK_HEAD`, `REVERT_HEAD`). With `headOid` it tells one stop from
   * the next, which `theirsOid` cannot outside a merge.
   */
  applyingOid?: string | null;
}

/** "Replaying commit 2 of 5: <subject>", read from `.git/rebase-merge`. */
export interface GitOperationStep {
  /** 1-based. */
  current: number;
  total: number;
  /** `null` for the am backend, which does not name the commit. */
  subject: string | null;
  /** The branch being rebased; `null` when it was detached. */
  branch: string | null;
}

export type GitOperationAction = 'continue' | 'skip' | 'abort';

/** Mirrors `GitOperationStepResult` in `src-tauri/src/git/types.rs`. */
export interface GitOperationStepResult {
  outcome: 'done' | 'stopped' | 'conflicts';
  operation: string;
  /** Paths, only for `conflicts`. */
  conflicts: string[];
  /** One plain sentence for `conflicts` and `stopped`. Never git's output. */
  message: string | null;
  /** git's own output, cleaned and tail-trimmed, for a fold. Only for `stopped`. */
  details?: string | null;
}

/** What `git merge <branch>` would do, computed in memory. Mirrors `GitMergePreview`. */
export interface GitMergePreview {
  outcome: 'up-to-date' | 'fast-forward' | 'clean' | 'conflicts';
  /** Paths that would conflict, sorted. Only for `conflicts`. */
  conflicts: string[];
  /** Commits on the branch that HEAD does not have. */
  commits: number;
}

export interface GitConflictFile {
  path: string;
  kind: GitConflictKind;
  /** `null` when the stage is absent or binary. */
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** diff3 text from `git2::merge_file`. `null` for binary and delete/modify conflicts. */
  merged: string | null;
  oursLabel: string;
  theirsLabel: string;
}

/** One line of a side changed since the merge base. Mirrors `LineOrigin` in `types.rs`. */
export interface LineOrigin {
  /** 1-based, in that side's own stage text. */
  line: number;
  oid: string;
}

export interface OriginCommit {
  oid: string;
  shortOid: string;
  summary: string;
  author: string;
  /** Unix seconds. */
  time: number;
}

/** Per side, the lines changed since the merge base; unchanged lines are absent. */
export interface GitConflictOrigins {
  ours: LineOrigin[];
  theirs: LineOrigin[];
  /** Every commit named above, once each. */
  commits: OriginCommit[];
}

export interface GitMergeStartResult {
  outcome: 'up-to-date' | 'fast-forward' | 'merged' | 'conflicts';
  /** New HEAD for fast-forward and merged. */
  oid: string | null;
  /** Paths, only for `conflicts`. */
  conflicts: string[];
}

/** Never throws for a folder that is not a repo: it reports `operation: 'none'`. */
export async function getMergeState(repoPath: string): Promise<GitMergeState> {
  return await invoke<GitMergeState>('git_merge_state', { repoPath });
}

/** The three stages and git's markered text for one conflicted path. */
export async function getConflictFile(
  repoPath: string,
  filePath: string
): Promise<GitConflictFile> {
  return await invoke<GitConflictFile>('git_conflict_file', { repoPath, filePath });
}

/** Which commits changed each side's lines since the merge base. Refuses without a merge. */
export async function getConflictOrigins(
  repoPath: string,
  filePath: string
): Promise<GitConflictOrigins> {
  return await invoke<GitConflictOrigins>('git_conflict_origins', { repoPath, filePath });
}

/** Writes and stages the resolved file. `null` resolves by deleting it. Never commits. */
export async function resolveConflict(
  repoPath: string,
  filePath: string,
  content: string | null
): Promise<void> {
  await invoke('git_resolve_conflict', { repoPath, filePath, content });
}

/**
 * Resolves by taking one index stage as-is: blob and mode, so it works for
 * binary files. A side without that stage (it deleted the file) removes it.
 */
export async function resolveConflictSide(
  repoPath: string,
  filePath: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  await invoke('git_resolve_conflict_side', { repoPath, filePath, side });
}

/** `git reset --merge`: paths the merge touched go back to HEAD, other edits stay. */
export async function abortMerge(repoPath: string): Promise<void> {
  await invoke('git_merge_abort', { repoPath });
}

/** Commits the merge. Refuses while any conflict is left. Returns the new oid. */
export async function concludeMerge(repoPath: string, message: string): Promise<string> {
  return await invoke<string>('git_merge_conclude', { repoPath, message });
}

/** Like `git merge <branch>`. Refuses on a dirty tree or while a merge is in progress. */
export async function mergeBranch(repoPath: string, branch: string): Promise<GitMergeStartResult> {
  return await invoke<GitMergeStartResult>('git_merge_branch', { repoPath, branch });
}

/** What merging `branch` would do. Touches neither the index nor the work tree. */
export async function previewMerge(repoPath: string, branch: string): Promise<GitMergePreview> {
  return await invoke<GitMergePreview>('git_merge_preview', { repoPath, branch });
}

/**
 * `git rebase|cherry-pick|revert --continue|--skip|--abort` with the real git.
 * Refuses during a merge, when nothing is in progress, and continue while
 * conflicts are left.
 */
export async function stepOperation(
  repoPath: string,
  action: GitOperationAction
): Promise<GitOperationStepResult> {
  return await invoke<GitOperationStepResult>('git_operation_step', { repoPath, action });
}
