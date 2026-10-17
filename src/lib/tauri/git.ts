export type GitStatusLabel =
  'added' | 'modified' | 'deleted' | 'untracked' | 'ignored' | 'conflicted';
export type GitStagedKind = 'added' | 'modified' | 'deleted';
/** `conflicted` comes with `status: 'conflicted'` and `staged: null`. */
export type GitUnstagedKind = 'modified' | 'deleted' | 'untracked' | 'conflicted';
export interface GitFileStatus {
  path: string;
  status: GitStatusLabel;
  staged: GitStagedKind | null;
  unstaged: GitUnstagedKind | null;
  /**
   * The executable bit differs on either side. Absent when false — Rust leaves
   * it off the wire. Says nothing about whether the content changed too.
   */
  modeChanged?: boolean;
}

import { invoke } from './invoke';

export interface BranchInfo {
  name: string;
  ahead: number;
  behind: number;
}

export type GitRepoKind = 'root' | 'nested' | 'submodule';

export interface GitRepoRef {
  /** Absolute work-tree path. The identity of a repo everywhere. */
  path: string;
  /** Relative to the project root, "" when the root itself is the repo. `/`-separated. */
  relativePath: string;
  /** Basename of the work tree (the project folder's name for the root repo). */
  name: string;
  kind: GitRepoKind;
}

/** Every git repo at or below `rootPath`, up to 4 levels deep. `[]` when none is found. */
export async function discoverGitRepos(rootPath: string): Promise<GitRepoRef[]> {
  return await invoke<GitRepoRef[]>('git_discover_repos', { rootPath });
}

/** Whether a project folder (or a git repo inside it) has uncommitted work. */
export interface ProjectDirty {
  path: string;
  dirty: boolean;
}

/** One row per input path, in the same order, echoing the path that was asked. */
export async function getProjectsDirty(paths: string[]): Promise<ProjectDirty[]> {
  return await invoke<ProjectDirty[]>('git_projects_dirty', { paths });
}

export async function getGitStatus(repoPath: string): Promise<GitFileStatus[]> {
  return await invoke<GitFileStatus[]>('git_status', { repoPath });
}

export async function getBranchInfo(repoPath: string): Promise<BranchInfo> {
  return await invoke<BranchInfo>('git_branch_info', { repoPath });
}

export async function stageFiles(repoPath: string, paths: string[]): Promise<void> {
  await invoke('git_stage', { repoPath, paths });
}

export async function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
  await invoke('git_unstage', { repoPath, paths });
}

export async function getGitDiff(
  repoPath: string,
  filePath: string,
  side?: 'staged' | 'unstaged'
): Promise<string> {
  return await invoke<string>(
    'git_diff',
    side === undefined ? { repoPath, filePath } : { repoPath, filePath, side }
  );
}

export async function commitChanges(repoPath: string, message: string): Promise<string> {
  return await invoke<string>('git_commit', { repoPath, message });
}

/** Pushes the current branch to origin; the backend handles credentials. */
export async function pushChanges(repoPath: string): Promise<void> {
  await invoke('git_push', { repoPath });
}

/** The diff a hunk was cut from, as the viewer showed it. */
export interface ApplyPatchGuard {
  filePath: string;
  side: 'staged' | 'unstaged';
  /** The raw patch `git_diff` returned for that side. */
  diff: string;
}

/**
 * Applies one hunk patch (see `src/lib/git/hunkPatch.ts`) to the index or the
 * work tree. Refuses, naming the file, when it no longer applies cleanly, or,
 * with `guard`, when that side's diff is no longer the one the hunk came from.
 */
export async function applyGitPatch(
  repoPath: string,
  patch: string,
  target: 'index' | 'workdir',
  guard?: ApplyPatchGuard
): Promise<void> {
  await invoke(
    'git_apply_patch',
    guard ? { repoPath, patch, target, guard } : { repoPath, patch, target }
  );
}

export async function discardChanges(repoPath: string, filePath: string): Promise<void> {
  await invoke('git_discard', { repoPath, filePath });
}

/** One commit as the evidence engine reads history. */
export interface CommitInfo {
  oid: string;
  summary: string;
  author: string;
  /** UTC, `YYYY-MM-DD HH:MM:SS`. */
  timestamp: string;
  /** Repo-relative paths this commit changed. */
  touched: string[];
}

/**
 * History from HEAD, newest first, capped server-side at 200 commits.
 * `sinceIso` cuts the walk; `pathPrefix` keeps only commits touching it.
 */
export async function gitLogSince(
  repoPath: string,
  sinceIso?: string,
  pathPrefix?: string
): Promise<CommitInfo[]> {
  return await invoke<CommitInfo[]>('git_log_since', { repoPath, sinceIso, pathPrefix });
}

export interface GitBranch {
  name: string;
  kind: 'local' | 'remote';
  isCurrent: boolean;
}

export interface GitNameStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface BlameHunk {
  oid: string;
  author: string;
  timestamp: string;
  summary: string;
  startLine: number;
  lineCount: number;
}

export async function listGitBranches(repoPath: string): Promise<GitBranch[]> {
  return await invoke<GitBranch[]>('git_list_branches', { repoPath });
}

export async function gitBlame(repoPath: string, filePath: string): Promise<BlameHunk[]> {
  return await invoke<BlameHunk[]>('git_blame', { repoPath, filePath });
}

export async function getGitDiffCommit(
  repoPath: string,
  oid: string,
  filePath: string
): Promise<string> {
  return await invoke<string>('git_diff_commit', { repoPath, oid, filePath });
}

export async function getGitDiffRefFiles(
  repoPath: string,
  refName: string
): Promise<GitNameStatus[]> {
  return await invoke<GitNameStatus[]>('git_diff_ref_files', { repoPath, refName });
}

/** Full oid of the best common ancestor of two revisions. Throws when they share none. */
export async function getMergeBase(repoPath: string, a: string, b: string): Promise<string> {
  return await invoke<string>('git_merge_base', { repoPath, a, b });
}

export async function getGitDiffFileRef(
  repoPath: string,
  refName: string,
  filePath: string
): Promise<string> {
  return await invoke<string>('git_diff_file_ref', { repoPath, refName, filePath });
}

/** A linked worktree, usually an Auric-managed agent checkout. */
export interface GitWorktree {
  path: string;
  name: string;
  branch: string | null;
  sourceRepo: string;
  isAuric: boolean;
  dirty: boolean;
  branchAhead: boolean;
}

export async function addGitWorktree(repoPath: string, name: string): Promise<GitWorktree> {
  return await invoke<GitWorktree>('git_worktree_add', { repoPath, name });
}

export async function listGitWorktrees(repoPath: string): Promise<GitWorktree[]> {
  return await invoke<GitWorktree[]>('git_worktree_list', { repoPath });
}

export async function removeGitWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean
): Promise<void> {
  await invoke('git_worktree_remove', { repoPath, worktreePath, force });
}

/** `main` or `master` — whichever this repository actually uses. */
export async function gitDefaultBranch(repoPath: string): Promise<string> {
  return await invoke<string>('git_default_branch', { repoPath });
}

export interface WorktreeMergeResult {
  defaultBranch: string;
  merged: boolean;
  fastForward: boolean;
  cleanedUp: boolean;
  oid: string | null;
  /** Paths left conflicted; empty unless the merge stopped in the main work tree. */
  conflicts: string[];
  /** Absent with older backends; never infer a push from a successful merge. */
  pushed?: boolean;
  pushError?: string | null;
  cleanupError?: string | null;
  remoteBranchError?: string | null;
}

/**
 * Commit leftover worktree changes if needed, merge into main/master, then
 * optionally push that exact branch to origin, then remove the worktree.
 * A failed push keeps the local merge and worktree. The backend picks the branch.
 */
export async function mergeGitWorktreeIntoDefault(
  repoPath: string,
  worktreePath: string,
  commitMessage?: string,
  push = false
): Promise<WorktreeMergeResult> {
  return await invoke<WorktreeMergeResult>('git_worktree_merge_into_default', {
    repoPath,
    worktreePath,
    commitMessage: commitMessage ?? null,
    push,
  });
}
