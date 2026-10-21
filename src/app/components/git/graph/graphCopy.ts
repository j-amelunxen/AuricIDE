import { reachableFrom } from '@/lib/git/graphLayout';
import type { GitRef, GitRefs, GraphCommit } from '@/lib/tauri/gitGraph';

export const SHORT_OID_LENGTH = 7;
const DETACHED_HEAD = 'the detached HEAD';

interface CommitTarget {
  oid: string;
  summary: string;
}

export type GraphOperationRequest =
  | { kind: 'checkout-commit'; commit: CommitTarget }
  | { kind: 'cherry-pick'; commit: CommitTarget; currentBranch: string | null }
  | { kind: 'revert'; commit: CommitTarget; currentBranch: string | null }
  | { kind: 'delete-branch'; name: string }
  | { kind: 'delete-branch-unmerged'; name: string; commitCount: number }
  | { kind: 'delete-tag'; name: string };

export interface OperationDescription {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
}

const MAX_SUMMARY_CHARS = 60;
const CONFLICT_HINT = ' If the change conflicts, the merge panel opens to finish it.';

/** A commit summary short enough for a sheet title; the full one is in the inspector. */
export function shortSummary(summary: string): string {
  return summary.length <= MAX_SUMMARY_CHARS
    ? summary
    : `${summary.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}

const quoted = (text: string) => `“${text}”`;
const quotedSummary = (summary: string) => quoted(shortSummary(summary));
const onBranch = (branch: string | null) => branch ?? DETACHED_HEAD;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the confirmation sheet says: the action named, the real branch and commit in the body. */
export function describeOperation(request: GraphOperationRequest): OperationDescription {
  switch (request.kind) {
    case 'checkout-commit':
      return {
        title: `Check Out ${quotedSummary(request.commit.summary)} (Detached)?`,
        body: `Your files change to match ${quotedSummary(request.commit.summary)} (${request.commit.oid.slice(0, SHORT_OID_LENGTH)}). HEAD will be on a commit, not on a branch, so new commits you make there belong to no branch until you create one.`,
        confirmLabel: 'Check Out',
        destructive: false,
      };
    case 'cherry-pick': {
      const branch = onBranch(request.currentBranch);
      return {
        title: `Cherry-Pick ${quotedSummary(request.commit.summary)}?`,
        body: `Apply the change of ${quotedSummary(request.commit.summary)} on top of ${branch}. This creates one new commit on ${branch}.${CONFLICT_HINT}`,
        confirmLabel: 'Cherry-Pick',
        destructive: false,
      };
    }
    case 'revert': {
      const branch = onBranch(request.currentBranch);
      return {
        title: `Revert ${quotedSummary(request.commit.summary)}?`,
        body: `Revert ${quotedSummary(request.commit.summary)} on ${branch}. This creates one new commit on ${branch}.${CONFLICT_HINT}`,
        confirmLabel: 'Revert',
        destructive: false,
      };
    }
    case 'delete-branch':
      return {
        title: `Delete Branch ${quoted(request.name)}?`,
        body: `The branch name is removed. Its commits stay in the repository as long as another branch or tag reaches them.`,
        confirmLabel: 'Delete',
        destructive: true,
      };
    case 'delete-branch-unmerged':
      return {
        title: `Delete Unmerged Branch ${quoted(request.name)}?`,
        body: `${quoted(request.name)} is not merged. ${plural(request.commitCount, 'commit')} on it ${request.commitCount === 1 ? 'is' : 'are'} reached by no other branch or tag and would become unreachable.`,
        confirmLabel: 'Delete Anyway',
        destructive: true,
      };
    case 'delete-tag':
      return {
        title: `Delete Tag ${quoted(request.name)}?`,
        body: `Only the tag is removed. The commit it points at is not changed.`,
        confirmLabel: 'Delete',
        destructive: true,
      };
  }
}

/**
 * How many loaded commits only `branch` keeps alive: the ones reachable from
 * its tip and from no other ref. Counted over the loaded pages, which is
 * what the sheet can honestly name.
 */
export function countCommitsOnlyReachableFrom(
  commits: GraphCommit[],
  refs: GitRefs,
  branch: GitRef
): number {
  const own = reachableFrom(commits, branch.target);
  const others = new Set<string>();
  for (const other of refs.refs) {
    if (other.name === branch.name) continue;
    for (const oid of reachableFrom(commits, other.target)) others.add(oid);
  }
  let count = 0;
  for (const commit of commits) if (own.has(commit.oid) && !others.has(commit.oid)) count += 1;
  return count;
}
