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
  const target = stripSlash(relativePath);
  const exact = statuses.find((s) => stripSlash(s.path) === target);
  if (exact) return toBadge(exact.status);

  const underIgnored = statuses.some((s) => {
    if (s.status !== 'ignored') return false;
    const dir = stripSlash(s.path);
    return target.startsWith(`${dir}/`);
  });
  return underIgnored ? 'ignored' : undefined;
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
