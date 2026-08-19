import { useCallback } from 'react';
import { offerWorktreeMerge, type WorktreeMergeOfferAgent } from '@/lib/git/offerWorktreeMerge';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';

/**
 * After a worktree agent ends, ask whether to merge into main/master.
 * Shares the caller's confirm() so Stop then Merge are two questions, not two stacks.
 */
export function useWorktreeMergeOffer(
  confirm: (request: ConfirmRequest) => Promise<boolean>
): (agent: WorktreeMergeOfferAgent | undefined) => Promise<void> {
  const worktrees = useStore((s) => s.agentWorktrees);
  const defaultBranchFor = useStore((s) => s.defaultBranchFor);
  const mergeAgentWorktree = useStore((s) => s.mergeAgentWorktree);
  const showToast = useStore((s) => s.showToast);

  return useCallback(
    async (agent: WorktreeMergeOfferAgent | undefined) => {
      await offerWorktreeMerge({
        agent,
        worktrees,
        confirm,
        defaultBranchFor,
        mergeAgentWorktree,
        showToast,
      });
    },
    [confirm, defaultBranchFor, mergeAgentWorktree, showToast, worktrees]
  );
}
