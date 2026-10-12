import { useEffect } from 'react';
import { useStore } from '@/lib/store';

/** How often merge state is re-read while some repo has a merge in progress. */
export const MERGE_POLL_MS = 4000;

function refreshAllRepos(): void {
  const { repos, refreshMergeState } = useStore.getState();
  for (const repo of repos) void refreshMergeState(repo.path);
}

/**
 * Keeps `mergeStates` true to what git says. The file watcher ignores `.git/`,
 * so a merge started, concluded or aborted in a terminal is only seen by
 * asking: on mount and repo changes, whenever the window comes back, and
 * every few seconds while a merge is in progress (one IPC per repo).
 */
export function useMergeStateSync(): void {
  // Primitives, so neither selector re-renders on unrelated store writes.
  const repoKey = useStore((s) => s.repos.map((r) => r.path).join('\n'));
  const inProgress = useStore((s) => Object.values(s.mergeStates).some((m) => m.inProgress));

  useEffect(() => {
    refreshAllRepos();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAllRepos();
    };
    window.addEventListener('focus', refreshAllRepos);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refreshAllRepos);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [repoKey]);

  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(refreshAllRepos, MERGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [inProgress]);
}
