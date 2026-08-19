/** Branch names a repository may use as its trunk. Prefer `main` when both exist. */
const DEFAULT_BRANCH_CANDIDATES = ['main', 'master'] as const;

type DefaultBranchName = (typeof DEFAULT_BRANCH_CANDIDATES)[number];

/**
 * Pick `main` or `master` for this repository.
 *
 * `origin/HEAD` wins when it names one of those and the local branch exists —
 * that is the branch `git clone` checked out. Otherwise `main` beats `master`
 * when both are present, matching GitHub's default since 2020.
 */
export function resolveDefaultBranchName(input: {
  local: readonly string[];
  originHead?: string | null;
}): DefaultBranchName | null {
  const local = new Set(input.local);
  const origin = input.originHead;
  if ((origin === 'main' || origin === 'master') && local.has(origin)) {
    return origin;
  }
  for (const name of DEFAULT_BRANCH_CANDIDATES) {
    if (local.has(name)) return name;
  }
  return null;
}
