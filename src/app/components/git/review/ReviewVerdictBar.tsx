'use client';

import { useId, type Ref } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { approvePendingReason } from '@/lib/git/review/approveCheck';
import type { ReviewProgress } from '@/lib/git/review/reviewSession';

/** What Approve does for this session; `null` when there is nothing to approve into. */
export type ApproveKind = 'commit' | 'merge' | null;

const APPROVE_LABEL: Record<Exclude<ApproveKind, null>, string> = {
  // The commit itself happens in Source Control; the button must not claim it.
  commit: 'Approve, then commit…',
  merge: 'Approve and merge',
};

const APPROVE_HINT: Record<Exclude<ApproveKind, null>, string> = {
  commit: 'Closes the review and takes you to the commit box for this repo.',
  merge: 'Merges this worktree into its default branch, after asking.',
};

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Primary = 'request' | 'approve' | 'close';

/**
 * The end of a review: send the comments back, or approve. It states only
 * what blocks a verdict; how far the review has got is the file list's job.
 */
// code-gate: complexity-parameter-count - one destructured props object, named at the call site
export function ReviewVerdictBar({
  progress,
  openComments,
  approveKind,
  busy,
  refusal,
  primaryRef,
  onRequestChanges,
  onApprove,
  onApproveAnyway,
  onClose,
}: {
  progress: ReviewProgress;
  openComments: number;
  approveKind: ApproveKind;
  busy: boolean;
  /** Why the last Approve was refused after reading the changes again. */
  refusal: string | null;
  /** Receives keyboard focus on ⌘↵. Never Approve anyway: overriding is a deliberate click. */
  primaryRef: Ref<HTMLButtonElement>;
  onRequestChanges: () => void;
  onApprove: () => void;
  onApproveAnyway: () => void;
  onClose: () => void;
}) {
  const requestReasonId = useId();
  const approveReasonId = useId();
  const pending = approvePendingReason(progress);
  const canApprove = approveKind !== null && pending === null && progress.total > 0;
  const requestFirst = openComments > 0;
  // ⌘↵ lands on the verdict that can be given right now. When only an override is left there
  // is no default, and the review sends ⌘↵ to what still blocks instead.
  const primary: Primary | null = requestFirst
    ? 'request'
    : approveKind === null
      ? 'close'
      : canApprove
        ? 'approve'
        : null;
  const refFor = (name: Primary) => (primary === name ? primaryRef : undefined);
  const keysFor = (name: Primary) => (primary === name ? 'Meta+Enter' : undefined);

  return (
    <div
      data-testid="review-verdict-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-dark bg-panel-bg px-3 py-2"
    >
      {!requestFirst ? (
        <span id={requestReasonId} className="text-[11px] text-foreground-muted">
          Comment on a line to request changes.
        </span>
      ) : null}
      {refusal ? (
        <span
          id={approveReasonId}
          role="alert"
          data-testid="review-approve-refusal"
          className="text-[11px] font-medium text-amber-300"
        >
          {refusal}
        </span>
      ) : null}
      {approveKind !== null && pending && !refusal ? (
        <span
          id={approveReasonId}
          data-testid="review-approve-reason"
          className="text-[11px] text-foreground-muted"
        >
          Approve waits: {pending}.
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          ref={refFor('request')}
          data-testid="review-request-changes"
          disabled={!requestFirst || busy}
          aria-describedby={requestFirst ? undefined : requestReasonId}
          aria-keyshortcuts={keysFor('request')}
          onClick={onRequestChanges}
          title="Open an agent with the open comments as a checklist"
          className={`flex min-h-7 items-center gap-1 rounded border border-border-dark px-2.5 text-xs font-medium text-foreground hover:bg-hover-bg motion-safe:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          <AuricIcon name="rate_review" className="text-sm" />
          Request changes
          {requestFirst ? (
            <span className="tabular-nums text-foreground-muted">({openComments})</span>
          ) : null}
        </button>
        {approveKind === null ? (
          <button
            type="button"
            ref={refFor('close')}
            aria-keyshortcuts={keysFor('close')}
            onClick={onClose}
            className={`min-h-7 rounded px-2.5 text-xs font-medium text-foreground-muted hover:bg-hover-bg hover:text-foreground ${FOCUS_RING}`}
          >
            Close review
          </button>
        ) : (
          <>
            {!canApprove ? (
              <button
                type="button"
                data-testid="review-approve-anyway"
                disabled={busy || progress.total === 0}
                onClick={onApproveAnyway}
                title={APPROVE_HINT[approveKind]}
                className={`min-h-7 rounded px-2 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground disabled:opacity-50 ${FOCUS_RING}`}
              >
                Approve anyway
              </button>
            ) : null}
            <button
              type="button"
              ref={refFor('approve')}
              data-testid="review-approve"
              disabled={!canApprove || busy}
              aria-describedby={pending || refusal ? approveReasonId : undefined}
              aria-keyshortcuts={keysFor('approve')}
              onClick={onApprove}
              title={APPROVE_HINT[approveKind]}
              className={`flex min-h-7 items-center gap-1 rounded bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 motion-safe:active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-foreground-muted ${FOCUS_RING}`}
            >
              <AuricIcon name={approveKind === 'merge' ? 'merge' : 'check'} className="text-sm" />
              {APPROVE_LABEL[approveKind]}
            </button>
          </>
        )}
      </span>
    </div>
  );
}
