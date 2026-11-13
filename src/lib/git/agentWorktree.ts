import type { GitRepoRef } from '@/lib/tauri/git';
import { withoutTrailingSlash } from '@/lib/paths/withoutTrailingSlash';

/** Sibling folder next to a repo that holds Auric-managed agent worktrees. */
export const AURIC_WORKTREE_DIR_SUFFIX = '.auric-wt';

export function isAuricWorktreePath(path: string): boolean {
  return path.split(/[\\/]/).some((seg) => seg.endsWith(AURIC_WORKTREE_DIR_SUFFIX));
}

/** A running agent whose cwd is this checkout — removing it would yank the floor. */
export function worktreeIsOccupied(
  path: string,
  agents: readonly { status: string; repoPath?: string }[]
): boolean {
  return agents.some((agent) => agent.status === 'running' && agent.repoPath === path);
}

/**
 * Repos an agent worktree can be created from, given the working directory
 * and the git repos discovered under it.
 *
 * If the working directory itself is a repo, that is the only source — nested
 * checkouts stay inside it. Otherwise every discovered repo is offered so the
 * user can pick which one to branch.
 */
export function worktreeSourceRepos(cwd: string, repos: readonly GitRepoRef[]): GitRepoRef[] {
  const target = withoutTrailingSlash(cwd);
  if (!target) return [];
  const self = repos.find((repo) => withoutTrailingSlash(repo.path) === target);
  if (self) return [self];
  return repos.filter((repo) => {
    const path = withoutTrailingSlash(repo.path);
    return path === target || path.startsWith(`${target}/`);
  });
}

/** True when cwd is not a git repo but at least one nested repo can be branched. */
export function needsWorktreeRepoPicker(cwd: string, repos: readonly GitRepoRef[]): boolean {
  const sources = worktreeSourceRepos(cwd, repos);
  const target = withoutTrailingSlash(cwd);
  if (!target || sources.length === 0) return false;
  return sources.every((repo) => withoutTrailingSlash(repo.path) !== target);
}
