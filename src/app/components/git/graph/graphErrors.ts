import type { GitError } from '@/lib/tauri/gitGraph';

/** `already_applied` is no refusal to dress up: the caller shows its sentence alone. */
export type RefusalCode = Exclude<GitError['code'], 'already_applied'> | 'busy';

const TITLES: Record<RefusalCode, string> = {
  invalid_name: 'That name is not allowed',
  already_exists: 'That name is already taken',
  not_found: 'The branch, tag or commit no longer exists',
  not_merged: 'The branch is not merged',
  current_branch: 'You are on this branch',
  would_overwrite: 'Your changes are in the way',
  operation_in_progress: 'Another operation is still open',
  dirty_worktree: 'You have uncommitted changes',
  remote_ref: 'Remote branches stay untouched',
  git_failed: 'Git could not finish',
  unknown: 'Git refused the operation',
  busy: 'Another operation is running',
};

export const refusalTitle = (code: RefusalCode): string => TITLES[code];

/** A refusal reads as its title, then the one sentence Rust sent; never raw git text. */
export const refusalToastText = (code: RefusalCode, sentence: string): string =>
  `${refusalTitle(code)}. ${sentence}`;
