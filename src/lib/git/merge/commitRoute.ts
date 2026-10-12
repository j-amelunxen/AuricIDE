/**
 * What "Commit" means for a repo, given the operation git has in progress.
 * During a merge, a plain commit would drop MERGE_HEAD and record the result
 * as an ordinary commit, so the button concludes the merge instead. Rebase,
 * cherry-pick and revert have their own continue steps the IDE does not run,
 * so it refuses rather than commit in the middle of one. A commit agent is
 * refused during any of them: it would run `git commit` itself.
 */
import type { GitMergeState } from '@/lib/tauri/gitMerge';

export type CommitRoute =
  { kind: 'commit' } | { kind: 'conclude-merge' } | { kind: 'refuse'; message: string };

export function operationBlocksCommitMessage(operation: string): string {
  const name = operation === 'other' ? 'git operation' : operation;
  return `A ${name} is in progress in this repo. Finish or abort it before committing.`;
}

export function commitRouteFor(
  state: Pick<GitMergeState, 'inProgress' | 'operation'> | null | undefined,
  { agentic }: { agentic: boolean }
): CommitRoute {
  if (!state?.inProgress || state.operation === 'none') return { kind: 'commit' };
  if (state.operation === 'merge' && !agentic) return { kind: 'conclude-merge' };
  return { kind: 'refuse', message: operationBlocksCommitMessage(state.operation) };
}
