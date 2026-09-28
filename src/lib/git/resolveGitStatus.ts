import type { GitFileStatus, GitRepoRef } from '@/lib/tauri/git';
import type { FileNode } from '@/lib/store/fileTreeSlice';
import { relativeToRepo, repoForPath } from './repos';

function stripSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function toBadge(status: GitFileStatus['status']): FileNode['gitStatus'] {
  if (status === 'untracked' || status === 'added') return 'added';
  if (status === 'modified') return 'modified';
  if (status === 'deleted') return 'deleted';
  if (status === 'ignored') return 'ignored';
  return undefined;
}

/**
 * Maps a tree path onto git status.
 *
 * libgit2 reports ignored directories with a trailing slash (`build/`),
 * while the explorer's relative paths never have one (`build`). An ignored
 * folder also covers every path underneath it — git does not list the
 * children once the directory itself is ignored.
 */
export function resolveGitStatus(
  relativePath: string,
  statuses: GitFileStatus[]
): FileNode['gitStatus'] {
  const { exact, ignoredDirs } = indexFor(statuses);
  const target = stripSlash(relativePath);
  const hit = exact.get(target);
  if (hit) return toBadge(hit);

  if (ignoredDirs.size === 0) return undefined;
  for (let i = target.indexOf('/'); i !== -1; i = target.indexOf('/', i + 1)) {
    if (ignoredDirs.has(target.slice(0, i))) return 'ignored';
  }
  return undefined;
}

interface StatusIndex {
  exact: Map<string, GitFileStatus['status']>;
  ignoredDirs: Set<string>;
}

/**
 * One lookup table per status array. The explorer resolves every visible node
 * against the same array; scanning it linearly per node made a large status
 * list (an un-ignored build folder) cost nodes × statuses on every refresh.
 */
const indexCache = new WeakMap<GitFileStatus[], StatusIndex>();

function indexFor(statuses: GitFileStatus[]): StatusIndex {
  const cached = indexCache.get(statuses);
  if (cached) return cached;
  const exact = new Map<string, GitFileStatus['status']>();
  const ignoredDirs = new Set<string>();
  for (const s of statuses) {
    const path = stripSlash(s.path);
    if (!exact.has(path)) exact.set(path, s.status);
    if (s.status === 'ignored') ignoredDirs.add(path);
  }
  const index = { exact, ignoredDirs };
  indexCache.set(statuses, index);
  return index;
}

/**
 * Multi-repo entry point the explorer uses: resolves `absPath` to its deepest
 * repo, then maps it through that repo's own statuses only. A nested repo's
 * own directory therefore never inherits a badge from the enclosing repo —
 * the outer repo may list `api/` as untracked, but `api` resolves to the
 * `api` repo itself (relative path `""`), whose own status list has no entry
 * for its own root.
 */
export function resolveGitStatusForPath(
  absPath: string,
  repos: readonly GitRepoRef[],
  statusesByRepo: Readonly<Record<string, GitFileStatus[]>>
): FileNode['gitStatus'] {
  const repo = repoForPath(absPath, repos);
  if (!repo) return undefined;
  const relativePath = relativeToRepo(absPath, repo.path);
  const statuses = statusesByRepo[repo.path] ?? [];
  return resolveGitStatus(relativePath, statuses);
}
