'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';

/** Bursts of watcher events and focus changes collapse into one read. */
export const REVIEW_REFRESH_DEBOUNCE_MS = 300;

interface WatchedState {
  repoStates: Record<string, { fileStatuses: unknown } | undefined>;
  agentWorktrees: readonly { path: string; dirty: boolean; branchAhead: boolean }[];
  agents: readonly { id: string; status: string; repoPath?: string }[];
}

/**
 * What says "the files under this review may have changed": the repo's git
 * status (rewritten whenever the file watcher fires), the worktree's dirty and
 * ahead flags, and an agent working there starting or stopping. Agent
 * worktrees sit outside the project, where the watcher does not look, so for
 * them the agents and the window coming back are the signals.
 */
function signature(state: WatchedState, repoPath: string): unknown[] {
  const tree = state.agentWorktrees.find((wt) => wt.path === repoPath);
  const agents = state.agents
    .filter((a) => a.repoPath === repoPath)
    .map((a) => `${a.id}:${a.status}`)
    .join(',');
  return [
    state.repoStates[repoPath]?.fileStatuses,
    tree ? `${tree.dirty}:${tree.branchAhead}` : '',
    agents,
  ];
}

function differs(a: unknown[], b: unknown[]): boolean {
  return a.some((value, i) => value !== b[i]);
}

/**
 * Reads the review's change set again when it may have changed: on the
 * window coming back and on the signals above, so "changed since you viewed
 * it" shows up without a click.
 */
export function useReviewAutoRefresh(tabId: string, repoPath: string | null): void {
  useEffect(() => {
    if (!repoPath) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void useStore.getState().refreshReviewSession(tabId);
      }, REVIEW_REFRESH_DEBOUNCE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    let last = signature(useStore.getState(), repoPath);
    const unsubscribe = useStore.subscribe((state) => {
      const next = signature(state, repoPath);
      if (!differs(next, last)) return;
      last = next;
      refresh();
    });
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [repoPath, tabId]);
}
