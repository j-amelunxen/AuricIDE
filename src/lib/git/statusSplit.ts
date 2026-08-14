import type { GitFileStatus } from '@/lib/tauri/git';

export function isStaged(status: GitFileStatus): boolean {
  return status.staged !== null;
}

export function isUnstagedTracked(status: GitFileStatus): boolean {
  return status.unstaged === 'modified' || status.unstaged === 'deleted';
}

export function isUntracked(status: GitFileStatus): boolean {
  return status.unstaged === 'untracked';
}
