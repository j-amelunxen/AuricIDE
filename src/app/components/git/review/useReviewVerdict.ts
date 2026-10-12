'use client';

import { useCallback, useState } from 'react';
import { isAuricWorktreePath, worktreeIsOccupied } from '@/lib/git/agentWorktree';
import { approveDecision, changedFileCount } from '@/lib/git/review/approveCheck';
import { reviewProgress, viewedMarksKey, type ReviewSource } from '@/lib/git/review/reviewSession';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { useStore } from '@/lib/store';
import { selectViewedMarks } from '@/lib/store/reviewSlice';
import type { ApproveKind } from './ReviewVerdictBar';

export function repoName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/**
 * Approve on a working tree ends at the commit box; on an agent worktree it is
 * the worktree merge. A branch compared with a ref has nothing to approve into.
 */
export function approveKindFor(source: ReviewSource): ApproveKind {
  if (isAuricWorktreePath(source.repoPath)) return 'merge';
  return source.kind === 'worktree' ? 'commit' : null;
}

/** Approve and close. Request changes needs no state and lives in `sendReviewComments`. */
export function useReviewVerdict({
  tabId,
  source,
  agentName,
  onApproveWorkingTree,
  announce,
}: {
  tabId: string;
  source: ReviewSource | null;
  agentName: string | null;
  onApproveWorkingTree?: (repoPath: string) => void;
  announce?: (message: string) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const offerMerge = useWorktreeMergeOffer(confirm);
  const [busy, setBusy] = useState(false);
  /** Why the last Approve did not go through; cleared by the next attempt. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const closeReview = useCallback(() => {
    const store = useStore.getState();
    store.closeTab(tabId);
    store.closeReviewSession(tabId);
  }, [tabId]);

  /** Reads the change set again and decides on what is there now, not on what was on screen. */
  const check = useCallback(
    async (anyway: boolean): Promise<boolean> => {
      if (!source) return false;
      const before = useStore.getState().reviewSessions[tabId]?.files ?? [];
      await useStore.getState().refreshReviewSession(tabId);
      const state = useStore.getState();
      const session = state.reviewSessions[tabId];
      if (!session || session.error) {
        setRefusal(`Could not read the changes again: ${session?.error ?? 'the review closed'}.`);
        return false;
      }
      const marks = selectViewedMarks(state, viewedMarksKey(source));
      const decision = approveDecision({
        progress: reviewProgress(session.files, marks),
        occupied: worktreeIsOccupied(source.repoPath, state.agents),
        changed: changedFileCount(before, session.files),
        anyway,
      });
      if (decision.kind === 'refuse') {
        setRefusal(decision.reason);
        announce?.(decision.reason);
        return false;
      }
      if (decision.kind === 'confirm') {
        return confirm({
          title: 'Approve anyway?',
          message: decision.message,
          confirmLabel: 'Approve anyway',
          variant: 'elevate',
        });
      }
      return true;
    },
    [announce, confirm, source, tabId]
  );

  const approve = useCallback(
    async ({ anyway = false }: { anyway?: boolean } = {}) => {
      if (!source || busy) return;
      const kind = approveKindFor(source);
      if (kind === null) return;
      setBusy(true);
      setRefusal(null);
      try {
        if (!(await check(anyway))) return;
        if (kind === 'commit') {
          onApproveWorkingTree?.(source.repoPath);
          closeReview();
          return;
        }
        const tree = useStore.getState().agentWorktrees.find((wt) => wt.path === source.repoPath);
        // Asks first, commits leftover work, merges; on conflict the merge panel takes over.
        await offerMerge({
          name: agentName ?? tree?.branch ?? repoName(source.repoPath),
          repoPath: source.repoPath,
        });
        // A merge that went through removes the worktree; there is nothing left to review.
        if (!useStore.getState().agentWorktrees.some((wt) => wt.path === source.repoPath)) {
          closeReview();
        }
      } finally {
        setBusy(false);
      }
    },
    [agentName, busy, check, closeReview, offerMerge, onApproveWorkingTree, source]
  );

  return { approve, closeReview, busy, refusal, confirmDialog };
}
