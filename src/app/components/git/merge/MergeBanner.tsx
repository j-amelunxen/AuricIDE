'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { buildResolveAllPrompt } from '@/lib/git/merge/resolveAllPrompt';
import { mergeTabId } from '@/lib/git/mergeTabId';
import { useStore } from '@/lib/store';
import { selectRepoConflicts } from '@/lib/store/mergeSlice';
import type { GitWorktree } from '@/lib/tauri/git';
import type { GitConflictKind, GitMergeState, GitOperationAction } from '@/lib/tauri/gitMerge';
import { pluralize, stepCopy, stepLine } from './mergeCopy';
import { openMergeTabOrToast } from '@/lib/ide/openMergeTab';

export interface MergeBannerProps {
  repoPath: string;
  /** The repo's commit box text, reused as the merge commit message. */
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
}

const KIND_HINT: Record<GitConflictKind, (ours: string, theirs: string) => string> = {
  content: () => 'both edited',
  'both-added': () => 'both added',
  'deleted-by-us': (ours) => `deleted on ${ours}`,
  'deleted-by-them': (_ours, theirs) => `deleted on ${theirs}`,
  binary: () => 'binary',
  symlink: () => 'link target',
};

const OPERATION_NAME: Record<string, string> = {
  rebase: 'A rebase',
  'cherry-pick': 'A cherry-pick',
  revert: 'A revert',
};

const BUTTON =
  'inline-flex min-h-7 items-center gap-1.5 rounded border border-border-dark px-2 py-1 text-[11px] font-medium text-foreground transition-[transform,background-color,border-color] duration-100 ease-out hover:border-primary/40 hover:bg-primary/10 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none';

const OPERATION_TITLE: Record<string, string> = {
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

const FAILED_VERB: Record<GitOperationAction, string> = {
  continue: 'continue',
  skip: 'skip the commit in',
  abort: 'abort',
};

const PRIMARY =
  'min-h-7 w-full whitespace-nowrap rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none';

const QUIET =
  'inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium text-foreground-muted transition-[background-color,color] duration-100 ease-out hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

/** Closes the merge tabs of one repo: after an abort or a commit their documents are gone. */
function closeRepoMergeTabs(repoPath: string) {
  const store = useStore.getState();
  const prefix = mergeTabId(repoPath, '');
  for (const tab of store.openTabs) {
    if (tab.id.startsWith(prefix)) store.closeTab(tab.id);
  }
}

/** Runs after the banner is gone, so it reads the store rather than the component. */
async function removeMergedWorktree(tree: GitWorktree): Promise<void> {
  const { removeAgentWorktree, showToast } = useStore.getState();
  try {
    // The branch is merged now, so only uncommitted work in the checkout needs force.
    await removeAgentWorktree(tree.path, tree.dirty);
    showToast(`Removed the worktree of ${tree.branch ?? tree.name}.`, 'info');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    showToast(`Merged, but the worktree could not be removed: ${detail}`, 'error');
  }
}

/**
 * Shown in Source Control while a merge is in progress in one repo: what is
 * merged into what, which files still conflict, and the three ways out
 * (resolve, hand to an agent, abort). It replaces the plain commit box,
 * because a commit during a merge is the merge commit.
 */
export function MergeBanner({ repoPath, commitMessage, onCommitMessageChange }: MergeBannerProps) {
  const mergeState = useStore((s) => s.mergeStates[repoPath]);
  const conflicts = useStore(useMemo(() => selectRepoConflicts(repoPath), [repoPath]));
  const abortMerge = useStore((s) => s.abortMerge);
  const concludeMerge = useStore((s) => s.concludeMerge);
  const showToast = useStore((s) => s.showToast);
  const agentWorktrees = useStore((s) => s.agentWorktrees);
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<'abort' | 'commit' | null>(null);

  // Prefill the message from MERGE_MSG once per merge; clearing the field afterwards sticks.
  const seededFor = useRef<string | null>(null);
  const mergeKey = mergeState?.inProgress ? `${mergeState.theirsOid ?? ''}` : null;
  useEffect(() => {
    if (mergeKey === null || seededFor.current === mergeKey) return;
    seededFor.current = mergeKey;
    if (!commitMessage.trim() && mergeState?.message) onCommitMessageChange(mergeState.message);
  }, [mergeKey, commitMessage, mergeState?.message, onCommitMessageChange]);

  if (!mergeState?.inProgress) return null;

  const ours = mergeState.oursLabel ?? 'HEAD';
  const theirs = mergeState.theirsLabel ?? 'the incoming branch';
  const isMerge = mergeState.operation === 'merge';
  const left = conflicts.length;
  // An agent's branch merged here leaves its worktree behind. Removal is
  // offered, never done: the human ticks it before committing. A dialog
  // after the commit cannot work, because the banner unmounts the moment
  // the merge ends.
  const agentTree = theirs.startsWith('auric/')
    ? agentWorktrees.find((w) => w.isAuric && w.branch === theirs && w.sourceRepo === repoPath)
    : undefined;

  const resolveWithAgent = () => {
    const store = useStore.getState();
    store.setSpawnAgentTicketId(null);
    store.setSpawnAgentGoalId(null);
    store.setSpawnAgentPreset(null);
    store.setInitialAgentTask(
      buildResolveAllPrompt({ repoPath, oursLabel: ours, theirsLabel: theirs, conflicts })
    );
    store.setSpawnAgentRepoPath(repoPath);
    store.setSpawnDialogOpen(true);
  };

  const abort = async () => {
    const ok = await confirm({
      title: 'Abort the merge?',
      message: `Files the merge touched go back to how they were before merging ${theirs}, including conflicts you already resolved. Your other uncommitted edits stay.`,
      confirmLabel: 'Abort merge',
      variant: 'destroy',
    });
    if (!ok) return;
    setBusy('abort');
    try {
      await abortMerge(repoPath);
      closeRepoMergeTabs(repoPath);
      // The prefilled merge message would otherwise become the next ordinary commit's.
      if (commitMessage === mergeState.message) onCommitMessageChange('');
      showToast(`Merge of ${theirs} aborted.`, 'info');
    } catch (err) {
      showToast(
        `Could not abort the merge: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    const message = commitMessage.trim();
    if (left > 0 || !message) return;
    setBusy('commit');
    try {
      const oid = await concludeMerge(repoPath, message);
      closeRepoMergeTabs(repoPath);
      onCommitMessageChange('');
      showToast(`Merged ${theirs} into ${ours} (${oid.slice(0, 7)}).`, 'success');
      if (agentTree && removeWorktree) await removeMergedWorktree(agentTree);
    } catch (err) {
      showToast(
        `Could not commit the merge: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  const commitBlocked =
    left > 0
      ? `Resolve ${pluralize(left, 'file', 'files')} first`
      : !commitMessage.trim()
        ? 'Write a commit message'
        : null;

  return (
    <section
      aria-label={isMerge ? 'Merge in progress' : 'Operation in progress'}
      data-testid={`merge-banner-${repoPath}`}
      className="rounded-lg border border-primary/30 bg-primary/[0.05]"
    >
      <header className="flex items-start gap-2 px-3 pt-2.5">
        <AuricIcon name="merge" className="mt-px shrink-0 text-sm text-primary-light" />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug text-foreground">
            {isMerge ? (
              <>
                Merging <span className="font-mono font-medium text-orange-200">{theirs}</span> into{' '}
                <span className="font-mono font-medium text-sky-200">{ours}</span>
              </>
            ) : (
              `${OPERATION_NAME[mergeState.operation] ?? 'A git operation'} is in progress`
            )}
          </p>
          {!isMerge && stepLine(mergeState.step) && (
            <p
              className="mt-0.5 truncate text-[11px] text-foreground"
              data-testid="operation-step"
              title={stepLine(mergeState.step) ?? undefined}
            >
              {stepLine(mergeState.step)}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-foreground-muted" data-testid="merge-banner-count">
            {left > 0 ? (
              `${pluralize(left, 'file', 'files')} left to resolve`
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <AuricIcon name="check_circle" className="text-xs" />
                All conflicts resolved
              </span>
            )}
          </p>
        </div>
      </header>

      {left > 0 && (
        <ul className="mt-2 border-y border-white/5 py-1" aria-label="Conflicted files">
          {conflicts.map((c) => (
            <li key={c.path}>
              <button
                type="button"
                onClick={() => openMergeTabOrToast(repoPath, c.path)}
                title={`Resolve ${c.path}`}
                className="flex min-h-7 w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              >
                <AuricIcon name="description" className="shrink-0 text-sm text-foreground-muted" />
                <span className="min-w-0 flex-1 truncate text-foreground">{c.path}</span>
                <span className="shrink-0 text-[10px] text-foreground-muted">
                  {KIND_HINT[c.kind]?.(ours, theirs) ?? c.kind}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-[10px] font-bold text-git-deleted"
                >
                  !
                </span>
                <span className="sr-only">, conflicted</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 px-3 py-2.5">
        {isMerge ? (
          <>
            {left > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={resolveWithAgent} className={BUTTON}>
                  <AuricIcon name="smart_toy" className="text-xs text-primary-light" />
                  Resolve all with an agent
                </button>
              </div>
            )}
            <textarea
              aria-label="Merge commit message"
              placeholder="Merge commit message"
              value={commitMessage}
              onChange={(e) => onCommitMessageChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
              rows={2}
              className="w-full resize-none rounded border border-border-dark bg-editor-bg px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
            />
            {agentTree && (
              <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-foreground-muted">
                <input
                  type="checkbox"
                  checked={removeWorktree}
                  onChange={(e) => setRemoveWorktree(e.target.checked)}
                  className="mt-px h-3.5 w-3.5 shrink-0 accent-primary"
                />
                <span>
                  Remove the agent worktree after committing
                  {agentTree.dirty ? '. It has uncommitted changes, they will be lost.' : ''}
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={() => void commit()}
              disabled={commitBlocked !== null || busy !== null}
              className={PRIMARY}
            >
              {busy === 'commit' ? 'Committing…' : 'Commit merge'}
            </button>
            <div className="flex items-center gap-2">
              <p
                className="min-w-0 flex-1 text-[10px] text-foreground-muted"
                data-testid="merge-commit-reason"
              >
                {commitBlocked}
              </p>
              <button
                type="button"
                onClick={() => void abort()}
                disabled={busy !== null}
                className={QUIET}
              >
                {busy === 'abort' ? 'Aborting…' : 'Abort merge'}
              </button>
            </div>
          </>
        ) : (
          <OperationSteps repoPath={repoPath} state={mergeState} left={left} />
        )}
      </div>
      {confirmDialog}
    </section>
  );
}

/**
 * Continue, skip and abort for a rebase, cherry-pick or revert. Each runs the
 * real git (`git_operation_step`); the merge docs of the replayed commit end
 * with it, so its tabs close and the next commit's conflict opens fresh.
 */
function OperationSteps({
  repoPath,
  state,
  left,
}: {
  repoPath: string;
  state: GitMergeState;
  left: number;
}) {
  const stepOperation = useStore((s) => s.stepOperation);
  const showToast = useStore((s) => s.showToast);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<GitOperationAction | null>(null);
  const [stop, setStop] = useState<{ message: string; details: string | null } | null>(null);
  const { operation } = state;
  const branch = state.step?.branch ?? null;
  const copy = stepCopy(operation, branch ?? state.oursLabel ?? 'HEAD');
  const title = OPERATION_TITLE[operation] ?? 'The operation';
  const what = branch ? `${title} of ${branch}` : title;

  const run = async (action: GitOperationAction) => {
    setBusy(action);
    setStop(null);
    try {
      const result = await stepOperation(repoPath, action);
      closeRepoMergeTabs(repoPath);
      if (result.outcome === 'done') {
        const aborted = action === 'abort';
        showToast(`${what} ${aborted ? 'aborted' : 'finished'}.`, aborted ? 'info' : 'success');
      } else if (result.outcome === 'conflicts') {
        showToast(result.message ?? 'Stopped on the next commit.', 'info');
        if (result.conflicts[0]) openMergeTabOrToast(repoPath, result.conflicts[0]);
      } else {
        setStop({
          message: result.message ?? `Git stopped before finishing the ${operation}.`,
          details: result.details ?? null,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      showToast(`Could not ${FAILED_VERB[action]} the ${operation}: ${reason}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirmThen = async (action: 'skip' | 'abort') => {
    const ok = await confirm(
      action === 'skip'
        ? {
            title: 'Skip this commit?',
            message: copy.skipMessage,
            confirmLabel: 'Skip commit',
            variant: 'discard',
          }
        : {
            title: `${copy.abortLabel}?`,
            message: copy.abortMessage,
            confirmLabel: copy.abortLabel,
            variant: 'destroy',
          }
    );
    if (ok) await run(action);
  };

  const blocked = left > 0 ? `Resolve ${pluralize(left, 'file', 'files')} first` : null;

  return (
    <>
      {stop && (
        <div
          role="status"
          data-testid="operation-stop"
          className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-2.5 py-2 text-[11px] leading-snug text-foreground"
        >
          <p>{stop.message}</p>
          {stop.details && (
            <details className="mt-1 text-foreground-muted">
              <summary className="cursor-pointer select-none">What git said</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">
                {stop.details}
              </pre>
            </details>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => void run('continue')}
        disabled={blocked !== null || busy !== null}
        className={PRIMARY}
      >
        {busy === 'continue' ? 'Continuing…' : copy.continueLabel}
      </button>
      {blocked && (
        <p className="text-[10px] text-foreground-muted" data-testid="operation-continue-reason">
          {blocked}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void confirmThen('skip')}
          disabled={busy !== null}
          className={BUTTON}
        >
          {busy === 'skip' ? 'Skipping…' : copy.skipLabel}
        </button>
        <button
          type="button"
          onClick={() => void confirmThen('abort')}
          disabled={busy !== null}
          className={QUIET}
        >
          {busy === 'abort' ? 'Aborting…' : copy.abortLabel}
        </button>
      </div>
      {confirmDialog}
    </>
  );
}
