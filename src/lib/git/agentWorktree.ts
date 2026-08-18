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
