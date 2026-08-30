import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { isAuricWorktreePath } from './agentWorktree';
import type { GitWorktree, WorktreeMergeResult } from '@/lib/tauri/git';

export interface WorktreeMergeOfferAgent {
  name: string;
  repoPath?: string;
}

export interface OfferWorktreeMergeInput {
  agent: WorktreeMergeOfferAgent | undefined;
  worktrees: readonly GitWorktree[];
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  defaultBranchFor: (repoPath: string) => Promise<string>;
  mergeAgentWorktree: (
    worktreePath: string,
    commitMessage?: string
  ) => Promise<WorktreeMergeResult>;
  /**
   * The subject line for whatever the agent left uncommitted. Written from the
   * diff, not from the prompt that started the agent — a commit says what
   * changed, and the prompt only says what somebody hoped would change.
   */
  commitSubjectFor: (worktreePath: string, task: string) => Promise<string>;
  showToast: (message: string, variant?: 'info' | 'success' | 'error') => unknown;
}

/**
 * After a worktree agent stops: ask whether to merge into main/master.
 * Yes commits leftover work, merges, then removes the worktree. No leaves it.
 */
export async function offerWorktreeMerge(input: OfferWorktreeMergeInput): Promise<void> {
  const agent = input.agent;
  const path = agent?.repoPath;
  if (!agent || !path || !isAuricWorktreePath(path)) return;

  const tree = input.worktrees.find((wt) => wt.path === path);
  let defaultBranch: string;
  try {
    defaultBranch = await input.defaultBranchFor(tree?.sourceRepo ?? path);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    input.showToast(`Could not find main or master: ${detail}`, 'error');
    return;
  }

  const branch = tree?.branch ?? 'this worktree';
  const go = await input.confirm({
    title: `Merge into ${defaultBranch}?`,
    message: tree?.dirty
      ? `Uncommitted work in ${branch} will be committed, then merged into ${defaultBranch}. The worktree is removed afterwards.`
      : `Merge ${branch} into ${defaultBranch}? After a successful merge the worktree is removed.`,
    confirmLabel: 'Merge',
    variant: 'elevate',
  });
  if (!go) return;

  let commitMessage = `Agent work: ${agent.name}`;
  try {
    commitMessage = await input.commitSubjectFor(path, agent.name);
  } catch {
    // A message we could not write is no reason to abandon the merge.
  }

  try {
    const result = await input.mergeAgentWorktree(path, commitMessage);
    input.showToast(`Merged into ${result.defaultBranch} and removed the worktree.`, 'success');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    input.showToast(`Could not merge: ${detail}`, 'error');
  }
}
