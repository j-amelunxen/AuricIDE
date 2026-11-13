import type { GitRepoRef } from '@/lib/tauri/git';
import { withoutTrailingSlash } from '@/lib/paths/withoutTrailingSlash';

/** Deepest repo whose path is the file's ancestor (or the file itself). null when none. */
export function repoForPath(absPath: string, repos: readonly GitRepoRef[]): GitRepoRef | null {
  const target = withoutTrailingSlash(absPath);
  let deepest: GitRepoRef | null = null;
  for (const repo of repos) {
    const repoPath = withoutTrailingSlash(repo.path);
    const isMatch = target === repoPath || target.startsWith(`${repoPath}/`);
    if (isMatch && (!deepest || repoPath.length > withoutTrailingSlash(deepest.path).length)) {
      deepest = repo;
    }
  }
  return deepest;
}

/** Repo-relative path, "" for the repo root. Assumes `absPath` is inside `repoPath`. */
export function relativeToRepo(absPath: string, repoPath: string): string {
  const target = withoutTrailingSlash(absPath);
  const repo = withoutTrailingSlash(repoPath);
  if (target === repo) return '';
  return target.startsWith(`${repo}/`) ? target.slice(repo.length + 1) : target;
}

/** "workspace" for the root repo, "api" / "libs/shared" for the others. */
export function repoLabel(repo: GitRepoRef): string {
  return repo.kind === 'root' ? repo.name : repo.relativePath;
}
