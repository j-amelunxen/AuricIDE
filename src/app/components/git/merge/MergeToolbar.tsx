'use client';

import { useId } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { GitOperation } from '@/lib/tauri/gitMerge';
import {
  describeSyntaxCheck,
  syntaxCheckScope,
  type SyntaxCheck,
} from '@/lib/git/merge/syntaxCheck';
import { pluralize, type SideLabels } from './mergeCopy';
import { OperationHeadline } from './OperationHeadline';

export interface MergeToolbarProps {
  filePath: string;
  labels: SideLabels;
  operation?: GitOperation;
  resolvedCount: number;
  total: number;
  /** Open conflicts the wand can settle. */
  simpleCount: number;
  canMarkResolved: boolean;
  /** Why Mark resolved is disabled; read out with the button, not shown twice. */
  blockedReason: string | null;
  busy: boolean;
  /**
   * Set after a press found that the file would not parse. The next press
   * goes ahead: the check advises, it never blocks.
   */
  syntaxWarning?: SyntaxCheck | null;
  onAutoResolve: () => void;
  onPrev: () => void;
  onNext: () => void;
  onMarkResolved: () => void;
}

const GHOST =
  'inline-flex min-h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The merge tab's header: what is merged into what, how far along, and the
 * file-level actions. One wrapping row ordered by container width: wide, the
 * path shares line one with Mark resolved; narrow, the path gets line one to
 * itself so it stays readable, and every action moves below it.
 */
// code-gate: complexity-function-length - one header row of markup; splitting it would scatter the order classes that lay it out
export function MergeToolbar(props: MergeToolbarProps) {
  const { filePath, labels, resolvedCount, total, simpleCount } = props;
  const reasonId = useId();
  const syntaxId = useId();
  const warning = props.syntaxWarning ?? null;
  const describedBy =
    [props.blockedReason ? reasonId : null, warning ? syntaxId : null].filter(Boolean).join(' ') ||
    undefined;
  const fraction = total === 0 ? 1 : resolvedCount / total;
  const navDisabled = total - resolvedCount === 0;
  return (
    <div className="@container border-b border-border-dark px-4 py-2.5" data-testid="merge-toolbar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="order-1 flex min-w-0 grow basis-full items-center gap-2 @min-[640px]:basis-0">
          <AuricIcon name="merge" className="shrink-0 text-sm text-primary-light" />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-foreground" title={filePath}>
              {filePath}
            </p>
            <OperationHeadline labels={labels} operation={props.operation} />
          </div>
        </div>

        <span aria-hidden="true" className="order-3 hidden h-0 basis-full @min-[640px]:block" />

        <div className="order-4 flex items-center gap-2" data-testid="merge-progress">
          <span className="text-[11px] tabular-nums text-foreground-muted">
            {resolvedCount} of {pluralize(total, 'conflict', 'conflicts')} resolved
          </span>
          <span
            className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.08]"
            role="progressbar"
            aria-label="Conflicts resolved"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={resolvedCount}
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </span>
        </div>
        <div className="order-5 flex items-center gap-0.5">
          <button
            type="button"
            className={GHOST}
            onClick={props.onPrev}
            disabled={navDisabled}
            aria-label="Previous open conflict"
            aria-keyshortcuts="Alt+ArrowUp"
            title="Previous open conflict (⌥↑)"
          >
            <AuricIcon name="arrow_upward" className="text-sm" />
          </button>
          <button
            type="button"
            className={GHOST}
            onClick={props.onNext}
            disabled={navDisabled}
            aria-label="Next open conflict"
            aria-keyshortcuts="Alt+ArrowDown"
            title="Next open conflict (⌥↓)"
          >
            <AuricIcon name="arrow_downward" className="text-sm" />
          </button>
        </div>
        <span className="order-6 ml-auto" />
        <button
          type="button"
          onClick={props.onAutoResolve}
          disabled={simpleCount === 0}
          title={
            simpleCount === 0
              ? 'No open conflict is safe to resolve automatically.'
              : 'Resolves conflicts where only one side changed, both made the same change, or the sides differ only in whitespace. Each says why.'
          }
          className="order-7 inline-flex min-h-7 items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary-light transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/20 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none"
        >
          <AuricIcon name="auto_fix_high" className="text-sm" />
          Resolve simple conflicts ({simpleCount})
        </button>

        <div className="order-8 flex shrink-0 items-center @min-[640px]:order-2">
          {/* The progress line already says how many are open; the reason is
          kept for assistive tech, attached to the button it explains. */}
          {props.blockedReason && (
            <span id={reasonId} className="sr-only" data-testid="mark-resolved-reason">
              {props.blockedReason}
            </span>
          )}
          <button
            type="button"
            onClick={props.onMarkResolved}
            disabled={!props.canMarkResolved || props.busy}
            aria-describedby={describedBy}
            aria-keyshortcuts="Meta+Enter"
            className="inline-flex min-h-7 items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs font-medium text-white transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-foreground-muted disabled:active:scale-100 motion-reduce:transition-none"
          >
            {props.busy ? 'Saving…' : warning ? 'Mark resolved anyway' : 'Mark resolved'}
            <kbd aria-hidden="true" className="font-sans text-[10px]">
              ⌘↵
            </kbd>
          </button>
        </div>
        {warning && (
          <p
            id={syntaxId}
            role="alert"
            data-testid="mark-resolved-syntax"
            className="order-9 flex basis-full items-start gap-1.5 text-[11px] leading-relaxed text-amber-200 @min-[640px]:order-2 @min-[640px]:justify-end @min-[640px]:text-right"
          >
            <AuricIcon name="warning" className="mt-px shrink-0 text-xs text-amber-300" />
            <span>
              {describeSyntaxCheck(warning)}. {syntaxCheckScope(warning)} Press again to mark it
              resolved anyway.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
