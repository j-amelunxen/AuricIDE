export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked' | 'ignored';
}

import { invoke } from './invoke';

export interface BranchInfo {
  name: string;
  ahead: number;
  behind: number;
  isDetached?: boolean;
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

export async function getGitDiff(repoPath: string, filePath: string): Promise<string> {
  return await invoke<string>('git_diff', { repoPath, filePath });
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
