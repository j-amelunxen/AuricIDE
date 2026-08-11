import type { CommitInfo } from '@/lib/tauri/git';
import type { PmGoalStation } from '@/lib/tauri/goals';

/**
 * Unclaimed work: commits appeared that no station claims. The detector
 * proposes; only a human decides — a proposal becomes a station on Claim,
 * or joins the dismissal memory on Dismiss and never nags again.
 */
export interface ForkProposal {
  /** Top-level path prefix the cluster shares, e.g. `src/mcp/`. */
  pathPrefix: string;
  suggestedName: string;
  commits: CommitInfo[];
}

/** Threshold below which activity is treated as noise, not a fork. */
export const FORK_MIN_COMMITS = 3;

function topLevelPrefix(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? `${parts.slice(0, 2).join('/')}/` : parts[0];
}

/**
 * Clusters commits by top-level path prefix and keeps the clusters no
 * station accounts for. Crude on purpose — the dismissal memory is the
 * pressure valve, and every proposal costs the user exactly one click.
 */
export function detectForks(
  commits: CommitInfo[],
  stations: PmGoalStation[],
  dismissedPrefixes: readonly string[]
): ForkProposal[] {
  const claimed = stations
    .map((s) => (s.predicate.type === 'git_touches' ? s.predicate.pathPrefix : null))
    .filter((p): p is string => p !== null);

  const clusters = new Map<string, CommitInfo[]>();
  for (const commit of commits) {
    const prefixes = new Set(commit.touched.map(topLevelPrefix));
    for (const prefix of prefixes) {
      const covered =
        claimed.some((c) => prefix.startsWith(c) || c.startsWith(prefix)) ||
        dismissedPrefixes.includes(prefix);
      if (covered) continue;
      const list = clusters.get(prefix) ?? [];
      list.push(commit);
      clusters.set(prefix, list);
    }
  }

  return [...clusters.entries()]
    .filter(([, list]) => list.length >= FORK_MIN_COMMITS)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pathPrefix, clusterCommits]) => ({
      pathPrefix,
      suggestedName: `Work in ${pathPrefix}`,
      commits: clusterCommits,
    }));
}
