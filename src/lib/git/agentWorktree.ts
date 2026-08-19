import type { GitRepoRef } from '@/lib/tauri/git';

/** Sibling folder next to a repo that holds Auric-managed agent worktrees. */
export const AURIC_WORKTREE_DIR_SUFFIX = '.auric-wt';

/** Branch namespace reserved for agent worktrees. */
export const AURIC_WORKTREE_BRANCH_PREFIX = 'auric/';

/** Turn an agent name into a path-safe slug used in the branch and folder. */
export function slugifyAgentWorktreeName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug || 'agent';
}

/** `<parent>/<repo>.auric-wt` — outside the checkout so discovery never finds it. */
export function auricWorktreeDir(repoPath: string): string {
  const normalized = repoPath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  const repoName = parts.pop() || 'repo';
  const parent = parts.join('/') || '/';
  return `${parent}/${repoName}${AURIC_WORKTREE_DIR_SUFFIX}`;
}

export function isAuricWorktreePath(path: string): boolean {
  return path.split(/[\\/]/).some((seg) => seg.endsWith(AURIC_WORKTREE_DIR_SUFFIX));
}

export function isAuricWorktreeBranch(branch: string | null | undefined): boolean {
  return Boolean(branch?.startsWith(AURIC_WORKTREE_BRANCH_PREFIX));
}

/** A running agent whose cwd is this checkout — removing it would yank the floor. */
export function worktreeIsOccupied(
  path: string,
  agents: readonly { status: string; repoPath?: string }[]
): boolean {
  return agents.some((agent) => agent.status === 'running' && agent.repoPath === path);
}

function stripSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
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
  const target = stripSlash(cwd);
  if (!target) return [];
  const self = repos.find((repo) => stripSlash(repo.path) === target);
  if (self) return [self];
  return repos.filter((repo) => {
    const path = stripSlash(repo.path);
    return path === target || path.startsWith(`${target}/`);
  });
}

/** True when cwd is not a git repo but at least one nested repo can be branched. */
export function needsWorktreeRepoPicker(cwd: string, repos: readonly GitRepoRef[]): boolean {
  const sources = worktreeSourceRepos(cwd, repos);
  const target = stripSlash(cwd);
  if (!target || sources.length === 0) return false;
  return sources.every((repo) => stripSlash(repo.path) !== target);
}
