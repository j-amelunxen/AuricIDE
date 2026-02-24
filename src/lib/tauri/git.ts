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

export async function discardChanges(repoPath: string, filePath: string): Promise<void> {
  await invoke('git_discard', { repoPath, filePath });
}
