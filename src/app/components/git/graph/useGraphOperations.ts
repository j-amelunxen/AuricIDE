import { useCallback } from 'react';
import { openMergeTabOrToast } from '@/lib/ide/openMergeTab';
import { useStore } from '@/lib/store';
import type { GraphOperationResult } from '@/lib/store/gitGraphSlice';
import { refusalToastText } from './graphErrors';

export type GraphOp =
  | { kind: 'checkout'; target: string; label: string }
  | { kind: 'branch-create'; name: string; atOid: string; checkout: boolean }
  | { kind: 'branch-rename'; oldName: string; newName: string }
  | { kind: 'branch-delete'; name: string; force: boolean }
  | { kind: 'tag-create'; name: string; oid: string; message?: string }
  | { kind: 'tag-delete'; name: string }
  | { kind: 'cherry-pick'; oid: string; summary: string }
  | { kind: 'revert'; oid: string; summary: string };

const quoted = (text: string) => `“${text}”`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function dispatch(repoPath: string, op: GraphOp): Promise<GraphOperationResult> {
  const s = useStore.getState();
  switch (op.kind) {
    case 'checkout':
      return s.graphCheckout(repoPath, op.target);
    case 'branch-create':
      return s.graphCreateBranch(repoPath, op.name, op.atOid, op.checkout);
    case 'branch-rename':
      return s.graphRenameBranch(repoPath, op.oldName, op.newName);
    case 'branch-delete':
      return s.graphDeleteBranch(repoPath, op.name, op.force);
    case 'tag-create':
      return s.graphCreateTag(repoPath, op.name, op.oid, op.message || undefined);
    case 'tag-delete':
      return s.graphDeleteTag(repoPath, op.name);
    case 'cherry-pick':
      return s.graphCherryPick(repoPath, op.oid);
    case 'revert':
      return s.graphRevert(repoPath, op.oid);
  }
}

function successText(op: GraphOp): string {
  switch (op.kind) {
    case 'checkout':
      return `Checked out ${op.label}`;
    case 'branch-create':
      return op.checkout ? `Created and checked out ${op.name}` : `Created branch ${op.name}`;
    case 'branch-rename':
      return `Renamed ${op.oldName} to ${op.newName}`;
    case 'branch-delete':
      return `Deleted branch ${op.name}`;
    case 'tag-create':
      return `Created tag ${op.name}`;
    case 'tag-delete':
      return `Deleted tag ${op.name}`;
    case 'cherry-pick':
      return `Cherry-picked ${quoted(op.summary)}`;
    case 'revert':
      return `Reverted ${quoted(op.summary)}`;
  }
}

const movesHead = (op: GraphOp) =>
  op.kind === 'checkout' ||
  op.kind === 'cherry-pick' ||
  op.kind === 'revert' ||
  (op.kind === 'branch-create' && op.checkout);

function reportConflict(repoPath: string, op: GraphOp, conflicts: string[]) {
  const name = op.kind === 'revert' ? 'Revert' : 'Cherry-pick';
  useStore
    .getState()
    .showToast(`${name} stopped on ${plural(conflicts.length, 'conflict')}`, 'info', {
      label: 'Open Merge Panel',
      run: () => openMergeTabOrToast(repoPath, conflicts[0]),
    });
}

/**
 * Runs one operation and tells the user how it went. A not_merged refusal of
 * a plain delete is returned silently: the caller turns it into a second sheet.
 */
export async function runGraphOperation(
  repoPath: string,
  op: GraphOp,
  onHeadMoved: () => void
): Promise<GraphOperationResult> {
  const result = await dispatch(repoPath, op);
  const { showToast } = useStore.getState();
  if (!result.ok) {
    const askAgain = op.kind === 'branch-delete' && !op.force && result.code === 'not_merged';
    if (result.code === 'already_applied') showToast(result.message, 'info');
    else if (!askAgain) showToast(refusalToastText(result.code, result.message), 'error');
    return result;
  }
  if (result.pick && !result.pick.clean) {
    reportConflict(repoPath, op, result.pick.conflicts);
    return result;
  }
  showToast(successText(op), 'success');
  if (movesHead(op)) onHeadMoved();
  return result;
}

export function useGraphOperations(repoPath: string, onHeadMoved: () => void) {
  return useCallback(
    (op: GraphOp) => runGraphOperation(repoPath, op, onHeadMoved),
    [repoPath, onHeadMoved]
  );
}
