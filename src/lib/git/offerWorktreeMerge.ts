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
    commitMessage?: string,
    push?: boolean
  ) => Promise<WorktreeMergeResult>;
  /**
   * The subject line for whatever the agent left uncommitted. Written from the
   * diff, not from the prompt that started the agent — a commit says what
   * changed, and the prompt only says what somebody hoped would change.
   */
  commitSubjectFor: (worktreePath: string, task: string) => Promise<string>;
  showToast: (message: string, variant?: 'info' | 'success' | 'error') => unknown;
  /**
   * The merge stopped on conflicts and is now in progress in the source
   * repo's main work tree. The caller opens the merge panel for it.
   */
  onConflicts?: (repoPath: string, conflicts: string[]) => void;
}

function conflictToast(count: number): string {
  return count === 1
    ? 'Merge stopped on 1 conflicting file. Resolve it in the merge panel.'
    : `Merge stopped on ${count} conflicting files. Resolve them in the merge panel.`;
}

/**
 * After a worktree agent stops: ask whether to merge into main/master.
 * Either affirmative action commits leftover work and merges. Cancel leaves it.
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
  let push = true;
  const go = await input.confirm({
    title: `Merge into ${defaultBranch}?`,
    message: [
      `Merge ${branch} into ${defaultBranch}.`,
      tree?.dirty ? 'Uncommitted work will be committed first.' : '',
      `Merge & push ${defaultBranch} merges locally, then pushes ${defaultBranch} to origin. After a successful push, the remote agent branch is deleted if it exists.`,
      `Merge locally updates local ${defaultBranch} only. Nothing is pushed.`,
      'The worktree is removed after success. If pushing fails, the local merge and worktree are kept.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    confirmLabel: `Merge & push ${defaultBranch}`,
    secondaryLabel: 'Merge locally',
    onSecondary: () => {
      push = false;
    },
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
    const result = await input.mergeAgentWorktree(path, commitMessage, push);
    // `?? []`: a backend from before the merge panel leaves the field off.
    const conflicts = result.conflicts ?? [];
    if (conflicts.length > 0) {
      input.onConflicts?.(tree?.sourceRepo ?? path, conflicts);
      input.showToast(conflictToast(conflicts.length), 'info');
      return;
    }
    reportMergeResult(result, input.showToast);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    input.showToast(`Could not merge: ${detail}`, 'error');
  }
}

function reportMergeResult(
  result: WorktreeMergeResult,
  showToast: OfferWorktreeMergeInput['showToast']
): void {
  const branch = result.defaultBranch;
  const action = result.merged ? 'Merged' : 'Already merged';
  if (result.pushError) {
    showToast(
      `${action} locally into ${branch}, but push to origin failed: ${result.pushError}. Local merge and worktree kept.`,
      'error'
    );
    return;
  }
  let message = result.pushed
    ? result.merged
      ? `Merged into ${branch} and pushed to origin.`
      : `Already merged into ${branch}; pushed to origin.`
    : `${action} ${result.merged ? 'locally ' : ''}into ${branch} (not pushed).`;
  message += result.cleanedUp
    ? ' Worktree removed.'
    : ` Could not remove the worktree: ${result.cleanupError ?? 'cleanup failed'}.`;
  if (result.remoteBranchError) {
    message += ` Could not delete the remote agent branch: ${result.remoteBranchError}.`;
  }
  showToast(
    message,
    !result.cleanedUp || result.remoteBranchError ? 'error' : result.merged ? 'success' : 'info'
  );
}
