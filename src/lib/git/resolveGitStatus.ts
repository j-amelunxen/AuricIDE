import type { GitFileStatus } from '@/lib/tauri/git';
import type { FileNode } from '@/lib/store/fileTreeSlice';

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
