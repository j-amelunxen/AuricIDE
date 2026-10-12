import type { GitFileStatus } from '@/lib/tauri/git';

/**
 * A path git cannot commit until someone resolves it. It belongs in none of
 * the ordinary lists: staging it from there would mark it resolved with the
 * markers still in it.
 */
export function isConflicted(status: GitFileStatus): boolean {
  return status.status === 'conflicted' || status.unstaged === 'conflicted';
}

export function isStaged(status: GitFileStatus): boolean {
  return status.staged !== null && !isConflicted(status);
}

export function isUnstagedTracked(status: GitFileStatus): boolean {
  if (isConflicted(status)) return false;
  return status.unstaged === 'modified' || status.unstaged === 'deleted';
}

export function isUntracked(status: GitFileStatus): boolean {
  return status.unstaged === 'untracked' && !isConflicted(status);
}
