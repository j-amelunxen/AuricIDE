import { useCallback } from 'react';
import { generateCommitSubject } from '@/lib/git/commitSubject';
import { offerWorktreeMerge, type WorktreeMergeOfferAgent } from '@/lib/git/offerWorktreeMerge';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import { getGitDiff, getGitStatus } from '@/lib/tauri/git';
import { llmCall } from '@/lib/tauri/llm';

const SUBJECT_SYSTEM =
  'You write git commit subject lines. You answer with the line itself and nothing else.';

/**
 * After a worktree agent ends, ask whether to merge into main/master.
 * Shares the caller's confirm() so Stop then Merge are two questions, not two stacks.
 */
export function useWorktreeMergeOffer(
  confirm: (request: ConfirmRequest) => Promise<boolean>
): (agent: WorktreeMergeOfferAgent | undefined) => Promise<void> {
  const worktrees = useStore((s) => s.agentWorktrees);
  const rootPath = useStore((s) => s.rootPath);
  const defaultBranchFor = useStore((s) => s.defaultBranchFor);
  const mergeAgentWorktree = useStore((s) => s.mergeAgentWorktree);
  const showToast = useStore((s) => s.showToast);

  const commitSubjectFor = useCallback(
    (worktreePath: string, task: string) =>
      generateCommitSubject({
        task,
        listChanges: () => getGitStatus(worktreePath),
        diffFor: (filePath) => getGitDiff(worktreePath, filePath),
        askLlm: async (prompt) => {
          const response = await llmCall({
            messages: [
              { role: 'system', content: SUBJECT_SYSTEM },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            maxTokens: 64,
            projectPath: rootPath ?? worktreePath,
          });
          return response.content;
        },
      }),
    [rootPath]
  );

  return useCallback(
    async (agent: WorktreeMergeOfferAgent | undefined) => {
      await offerWorktreeMerge({
        agent,
        worktrees,
        confirm,
        defaultBranchFor,
        mergeAgentWorktree,
        commitSubjectFor,
        showToast,
      });
    },
    [confirm, commitSubjectFor, defaultBranchFor, mergeAgentWorktree, showToast, worktrees]
  );
}
