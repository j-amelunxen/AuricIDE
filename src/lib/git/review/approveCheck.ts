/**
 * Whether a verdict of Approve may go through, decided on the change set as
 * it is now: the click first reads the changes again, because an agent may
 * have written to the files since the reviewer looked. A reviewer must never
 * approve a version they did not see without being told.
 */
import type { ReviewFile, ReviewProgress } from './reviewSession';

export type ApproveDecision =
  { kind: 'go' } | { kind: 'refuse'; reason: string } | { kind: 'confirm'; message: string };

/** "2 files not viewed yet, 1 changed since you viewed it", or `null` when nothing waits. */
export function approvePendingReason(progress: ReviewProgress): string | null {
  const notViewed = progress.total - progress.viewed - progress.changed;
  const parts: string[] = [];
  if (notViewed > 0) {
    parts.push(`${notViewed} ${notViewed === 1 ? 'file' : 'files'} not viewed yet`);
  }
  if (progress.changed > 0) {
    parts.push(
      `${progress.changed} changed since you viewed ${progress.changed === 1 ? 'it' : 'them'}`
    );
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** How many files differ between two readings of a change set: added, removed or changed. */
export function changedFileCount(
  before: readonly Pick<ReviewFile, 'path' | 'hash'>[],
  after: readonly Pick<ReviewFile, 'path' | 'hash'>[]
): number {
  const old = new Map(before.map((f) => [f.path, f.hash]));
  let changed = 0;
  for (const file of after) {
    if (old.get(file.path) !== file.hash) changed++;
    old.delete(file.path);
  }
  return changed + old.size;
}

export const AGENT_RUNNING_REASON =
  'An agent is still running here. Wait for it to finish, or stop it, before approving.';

export function approveDecision({
  progress,
  occupied,
  changed,
  anyway,
}: {
  progress: ReviewProgress;
  /** An agent is running in the repo or worktree under review. */
  occupied: boolean;
  /** Files that differ from what was on screen when Approve was clicked. */
  changed: number;
  anyway: boolean;
}): ApproveDecision {
  if (occupied) return { kind: 'refuse', reason: AGENT_RUNNING_REASON };
  if (progress.total === 0) return { kind: 'refuse', reason: 'Nothing is left to approve.' };
  const pending = approvePendingReason(progress);
  if (!anyway) {
    if (pending) {
      const prefix = changed > 0 ? 'The changes moved on while you reviewed. ' : '';
      return { kind: 'refuse', reason: `${prefix}Approve waits: ${pending}.` };
    }
    return { kind: 'go' };
  }
  if (changed > 0) {
    const files = changed === 1 ? '1 file has' : `${changed} files have`;
    return {
      kind: 'confirm',
      message: `${files} changed since you last looked, and you have not seen the new version. Approve anyway?`,
    };
  }
  return { kind: 'go' };
}
