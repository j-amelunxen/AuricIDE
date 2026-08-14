export type GitStatusLabel = 'added' | 'modified' | 'deleted' | 'untracked' | 'ignored';
export type GitStagedKind = 'added' | 'modified' | 'deleted';
export type GitUnstagedKind = 'modified' | 'deleted' | 'untracked';
export interface GitFileStatus {
  path: string;
  status: GitStatusLabel;
  staged: GitStagedKind | null;
  unstaged: GitUnstagedKind | null;
}

import { invoke } from './invoke';

export interface BranchInfo {
  name: string;
  ahead: number;
  behind: number;
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

export async function getGitDiffFileRef(
  repoPath: string,
  refName: string,
  filePath: string
): Promise<string> {
  return await invoke<string>('git_diff_file_ref', { repoPath, refName, filePath });
}
