import { invoke } from './invoke';
import type { GitNameStatus } from './git';

/** Mirrors `git/graph.rs` and `git/refs_ops.rs`; see `docs/design-git-graph.md`. */

export interface GraphCommit {
  oid: string;
  parents: string[];
  summary: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerTime: number;
}

export interface GraphPage {
  commits: GraphCommit[];
  hasMore: boolean;
}

export type GitRefKind = 'local' | 'remote' | 'tag' | 'head';

export interface GitRef {
  /** Full name: refs/heads/main, refs/remotes/origin/main, refs/tags/v1, HEAD. */
  name: string;
  shorthand: string;
  kind: GitRefKind;
  target: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  isCurrent: boolean;
}

export type GitOperationName = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'other';

export interface GitRefs {
  refs: GitRef[];
  headDetached: boolean;
  headOid: string | null;
  operation: GitOperationName;
}

export interface CommitDetail {
  oid: string;
  parents: string[];
  message: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  files: GitNameStatus[];
}

export interface PickResult {
  clean: boolean;
  conflicts: string[];
  newOid: string | null;
}

export function gitGraphLog(repoPath: string, skip: number, limit: number): Promise<GraphPage> {
  return invoke<GraphPage>('git_graph_log', { repoPath, skip, limit });
}

export function gitRefs(repoPath: string): Promise<GitRefs> {
  return invoke<GitRefs>('git_refs', { repoPath });
}

export function gitCommitDetail(
  repoPath: string,
  oid: string,
  parentIndex?: number
): Promise<CommitDetail> {
  return invoke<CommitDetail>('git_commit_detail', { repoPath, oid, parentIndex });
}

/** The commit's change to one file, against the chosen parent (a merge has several). */
export function getGitDiffCommitAtParent(
  repoPath: string,
  oid: string,
  filePath: string,
  parentIndex: number
): Promise<string> {
  return invoke<string>('git_diff_commit', { repoPath, oid, filePath, parentIndex });
}

/** `target` is a full ref name or an oid. */
export function gitCheckout(repoPath: string, target: string): Promise<void> {
  return invoke<void>('git_checkout', { repoPath, target });
}

export function gitBranchCreate(
  repoPath: string,
  name: string,
  atOid: string,
  checkout: boolean
): Promise<void> {
  return invoke<void>('git_branch_create', { repoPath, name, atOid, checkout });
}

export function gitBranchRename(repoPath: string, oldName: string, newName: string): Promise<void> {
  return invoke<void>('git_branch_rename', { repoPath, oldName, newName });
}

export function gitBranchDelete(repoPath: string, name: string, force: boolean): Promise<void> {
  return invoke<void>('git_branch_delete', { repoPath, name, force });
}

export function gitTagCreate(
  repoPath: string,
  name: string,
  oid: string,
  message?: string
): Promise<void> {
  return invoke<void>('git_tag_create', { repoPath, name, oid, message });
}

export function gitTagDelete(repoPath: string, name: string): Promise<void> {
  return invoke<void>('git_tag_delete', { repoPath, name });
}

export function gitCherryPick(repoPath: string, oid: string): Promise<PickResult> {
  return invoke<PickResult>('git_cherry_pick', { repoPath, oid });
}

export function gitRevert(repoPath: string, oid: string): Promise<PickResult> {
  return invoke<PickResult>('git_revert', { repoPath, oid });
}

export const GIT_ERROR_CODES = [
  'invalid_name',
  'already_exists',
  'not_found',
  'not_merged',
  'current_branch',
  'would_overwrite',
  'operation_in_progress',
  'dirty_worktree',
  'remote_ref',
  'already_applied',
  'git_failed',
] as const;

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

export interface GitError {
  code: GitErrorCode | 'unknown';
  message: string;
}

/** Shown when a refusal carries no code we know: raw git or IPC text never becomes the message. */
export const UNKNOWN_GIT_ERROR_MESSAGE = 'Git refused the operation.';

const KNOWN_CODES: ReadonlySet<string> = new Set(GIT_ERROR_CODES);

/** Splits the `<code>: <sentence>` string every write command rejects with. */
export function parseGitError(error: unknown): GitError {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const separator = text.indexOf(': ');
  const code = separator === -1 ? '' : text.slice(0, separator);
  if (!KNOWN_CODES.has(code)) return { code: 'unknown', message: UNKNOWN_GIT_ERROR_MESSAGE };
  const message = text.slice(separator + 2).trim();
  return { code: code as GitErrorCode, message: message || UNKNOWN_GIT_ERROR_MESSAGE };
}
