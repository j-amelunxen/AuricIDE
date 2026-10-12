'use client';

import { useId, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  hasConflictMarkers,
  resolutionLines,
  type ConflictSegment,
  type Resolution,
} from '@/lib/git/merge/conflictModel';
import type { WordSpan } from '@/lib/git/wordDiff';
import type { ConflictOrigin } from '@/lib/git/merge/conflictOrigins';
import {
  describeSyntaxCheck,
  syntaxCheckScope,
  type SyntaxCheck,
} from '@/lib/git/merge/syntaxCheck';
import type { ProposalState } from '@/lib/store/mergeSlice';
import type { OriginCommit } from '@/lib/tauri/gitMerge';
import { ariaKeyshortcuts } from '../shared/shortcutKeys';
import {
  pairedWordSpans,
  resolutionSummary,
  roleOf,
  sideName,
  type Side,
  type SideLabels,
} from './mergeCopy';
import { SideOrigin } from './SideOrigin';

/**
 * Sides get neutral tints that are not status colours (amber, emerald, red
 * and the accent stay with status), and each also carries a label and an
 * icon, so the two are told apart without colour.
 */
const SIDE_STYLE: Record<Side, { icon: string; pane: string; title: string; word: string }> = {
  ours: {
    icon: 'commit',
    pane: 'border-sky-400/20 bg-sky-400/[0.04]',
    title: 'text-sky-200',
    word: 'rounded-[2px] bg-sky-400/25 text-sky-50',
  },
  theirs: {
    icon: 'alt_route',
    pane: 'border-orange-300/20 bg-orange-300/[0.04]',
    title: 'text-orange-200',
    word: 'rounded-[2px] bg-orange-300/25 text-orange-50',
  },
};

const ACTION_BUTTON =
  'inline-flex min-h-7 items-center gap-1.5 rounded border border-border-dark px-2 py-1 text-[11px] font-medium text-foreground transition-[transform,background-color,border-color] duration-100 ease-out hover:border-primary/40 hover:bg-primary/10 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none';

const PRIMARY_BUTTON =
  'inline-flex min-h-7 items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-white transition-[transform,background-color] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none';

/**
 * A visual key hint. Hidden from assistive tech: the button it sits in names
 * the same shortcut through `aria-keyshortcuts`, which is read properly.
 */
function Kbd({ children, onPrimary = false }: { children: string; onPrimary?: boolean }) {
  return (
    <kbd
      aria-hidden="true"
      className={`font-sans text-[10px] font-normal tracking-wide ${
        onPrimary ? 'text-white' : 'text-foreground-muted'
      }`}
    >
      {children}
    </kbd>
  );
}

function CodeLines({
  lines,
  firstLineNo,
  spans,
  wordClass,
  emptyText,
}: {
  lines: readonly string[];
  firstLineNo?: number;
  spans?: (WordSpan[] | null)[];
  wordClass?: string;
  emptyText: string;
}) {
  if (lines.length === 0) {
    return <p className="px-3 py-2 text-[11px] italic text-foreground-muted">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto py-1 font-mono text-xs leading-5">
      {lines.map((line, i) => {
        const lineSpans = spans?.[i];
        return (
          <div key={i} className="flex min-w-max">
            <span className="w-10 shrink-0 select-none pr-2 text-right text-foreground-muted/80">
              {firstLineNo === undefined ? '' : firstLineNo + i}
            </span>
            <span className="whitespace-pre pr-3 text-foreground">
              {lineSpans
                ? lineSpans.map((span, j) =>
                    span.changed ? (
                      <span key={j} className={wordClass}>
                        {span.text}
                      </span>
                    ) : (
                      <span key={j}>{span.text}</span>
                    )
                  )
                : line || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SidePane({
  side,
  labels,
  lines,
  firstLineNo,
  spans,
  shortcut,
  origin,
  now,
}: {
  side: Side;
  labels: SideLabels;
  lines: readonly string[];
  firstLineNo: number;
  spans?: (WordSpan[] | null)[];
  shortcut: string;
  /** Commits that changed this side since the merge base, newest first. */
  origin?: readonly OriginCommit[];
  /** The moment ages are measured from. */
  now: number;
}) {
  const style = SIDE_STYLE[side];
  return (
    <div className={`min-w-0 rounded-md border ${style.pane}`} data-side={side}>
      <div className="border-b border-white/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <AuricIcon name={style.icon} className={`shrink-0 text-xs ${style.title}`} />
          <span className={`min-w-0 truncate text-[11px] font-medium ${style.title}`}>
            {sideName(labels, side)}
          </span>
          <span className="ml-auto shrink-0">
            <Kbd>{shortcut}</Kbd>
          </span>
        </div>
        <SideOrigin commits={origin} now={now} />
      </div>
      <CodeLines
        lines={lines}
        firstLineNo={firstLineNo}
        spans={spans}
        wordClass={style.word}
        emptyText="No lines on this side."
      />
    </div>
  );
}

function OriginalPane({ base }: { base: string[] | null }) {
  return (
    <div className="rounded-md border border-dashed border-border-dark bg-white/[0.02]">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
        <AuricIcon name="history" className="text-xs text-foreground-muted" />
        <span className="text-[11px] font-medium text-foreground-muted">
          Original (common ancestor)
        </span>
      </div>
      {base === null ? (
        <p className="px-3 py-2 text-[11px] text-foreground-muted">
          No original: both sides added this.
        </p>
      ) : (
        <CodeLines lines={base} emptyText="These lines did not exist in the original." />
      )}
    </div>
  );
}

const CONFIDENCE_DOTS: Record<string, number> = { high: 3, medium: 2, low: 1 };

function ConfidenceChip({ confidence }: { confidence: string }) {
  const filled = CONFIDENCE_DOTS[confidence] ?? 1;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border-dark px-1.5 py-px text-[10px] text-foreground-muted"
      data-testid="proposal-confidence"
    >
      <span aria-hidden="true" className="tracking-[-0.1em]">
        {'●'.repeat(filled)}
        <span className="opacity-30">{'●'.repeat(3 - filled)}</span>
      </span>
      {confidence} confidence
    </span>
  );
}

/**
 * Whether the file would still parse with this proposal in it. A warning is
 * advice, never a lock: the proposal stays usable either way.
 */
function ProposalSyntax({ check }: { check: SyntaxCheck | undefined }) {
  if (!check) return null;
  const headline = describeSyntaxCheck(check);
  const scope = syntaxCheckScope(check);
  const text = headline ?? (check.message ? `Not checked. ${check.message}` : null);
  if (!text) return null;
  const problem = check.kind === 'problem';
  return (
    <p
      className={`flex items-start gap-1.5 border-t border-white/5 px-3 py-1.5 text-[11px] leading-relaxed ${
        problem ? 'text-amber-200' : 'text-foreground-muted'
      }`}
      data-testid="proposal-syntax"
      data-kind={check.kind}
    >
      <AuricIcon
        name={problem ? 'warning' : check.kind === 'ok' ? 'check' : 'info'}
        className={`mt-px shrink-0 text-xs ${problem ? 'text-amber-300' : ''}`}
      />
      <span>
        {text}
        {scope && <span className="text-foreground-muted"> {scope}</span>}
      </span>
    </p>
  );
}

function ProposalBlock({
  proposal,
  check,
  onAccept,
  onEdit,
  onDismiss,
  onRetry,
}: {
  proposal: ProposalState;
  check: SyntaxCheck | undefined;
  onAccept: () => void;
  onEdit: (lines: string[]) => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  if (proposal.status === 'loading') {
    return (
      <div
        className="rounded-md border border-dashed border-primary/30 px-3 py-2"
        aria-busy="true"
        data-testid="proposal-loading"
      >
        <div className="flex items-center gap-2 text-[11px] text-foreground-muted">
          <AuricIcon name="smart_toy" className="text-xs text-primary-light" />
          Asking the model for a proposal…
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto inline-flex min-h-6 items-center rounded px-2 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            Cancel
          </button>
        </div>
        <div className="mt-2 space-y-1.5" aria-hidden="true">
          {['w-3/4', 'w-1/2', 'w-2/3'].map((width) => (
            <div
              key={width}
              className={`h-2.5 ${width} animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none`}
            />
          ))}
        </div>
      </div>
    );
  }
  if (proposal.status === 'error') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[11px]"
        data-testid="proposal-error"
      >
        <AuricIcon name="error" className="text-xs text-red-400" />
        <span className="min-w-0 flex-1 text-red-200">No usable proposal. {proposal.reason}</span>
        <button type="button" onClick={onRetry} className={ACTION_BUTTON}>
          Retry
        </button>
        <button type="button" onClick={onDismiss} className={ACTION_BUTTON}>
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div
      className="rounded-md border border-primary/30 bg-primary/[0.04]"
      data-testid="proposal-ready"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <AuricIcon name="smart_toy" className="text-xs text-primary-light" />
        <span className="text-[11px] font-medium text-foreground">Agent proposal</span>
        <ConfidenceChip confidence={proposal.confidence} />
        <span className="ml-auto text-[10px] text-foreground-muted">
          Not applied until you use it
        </span>
      </div>
      <CodeLines lines={proposal.lines} emptyText="The proposal removes these lines." />
      <p className="border-t border-white/5 px-3 py-1.5 text-[11px] leading-relaxed text-foreground-muted">
        {proposal.rationale}
      </p>
      <ProposalSyntax check={check} />
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        <button type="button" onClick={onAccept} className={PRIMARY_BUTTON}>
          <AuricIcon name="check" className="text-xs" />
          Use proposal
        </button>
        <button type="button" onClick={() => onEdit(proposal.lines)} className={ACTION_BUTTON}>
          Edit
        </button>
        <button type="button" onClick={onDismiss} className={ACTION_BUTTON}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Editor({
  ordinal,
  initial,
  onSave,
  onCancel,
}: {
  ordinal: number;
  initial: string;
  onSave: (lines: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const markers = hasConflictMarkers(text);
  const save = () => {
    if (markers) return;
    onSave(text === '' ? [] : text.split('\n'));
  };
  return (
    <div className="space-y-1.5">
      <textarea
        // The editor opens on request, so taking focus is what the request asked for.
        autoFocus
        aria-label={`Resolution for conflict ${ordinal}`}
        value={text}
        spellCheck={false}
        rows={Math.min(Math.max(text.split('\n').length + 1, 4), 18)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-y rounded-md border border-border-dark bg-editor-bg px-3 py-2 font-mono text-xs leading-5 text-foreground focus:border-primary focus:outline-none"
      />
      {markers && (
        <p role="alert" className="flex items-center gap-1.5 text-[11px] text-red-300">
          <AuricIcon name="warning" className="text-xs" />
          This still contains a conflict marker line. Remove it to use the text.
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={markers}
          aria-keyshortcuts={ariaKeyshortcuts(['⌘', '↵'])}
          className={PRIMARY_BUTTON}
        >
          Use this text <Kbd onPrimary>⌘↵</Kbd>
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-keyshortcuts="Escape"
          className={ACTION_BUTTON}
        >
          Cancel <Kbd>esc</Kbd>
        </button>
      </div>
    </div>
  );
}

export interface ConflictCardProps {
  conflict: ConflictSegment;
  /** 1-based position among the file's conflicts. */
  ordinal: number;
  total: number;
  labels: SideLabels;
  lineNos: { ours: number; theirs: number };
  resolution: Resolution | undefined;
  autoReason: string | undefined;
  /** A dismissed proposal is gone from the store, so it arrives as undefined. */
  proposal: ProposalState | undefined;
  /** The file with a ready proposal used, run through the syntax check. */
  proposalCheck?: SyntaxCheck;
  /** Why each side looks like this; absent while unknown. */
  origin?: ConflictOrigin;
  focused: boolean;
  showOriginal: boolean;
  bothFirst: Side;
  cardRef?: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onToggleOriginal: () => void;
  onBothFirstChange: (side: Side) => void;
  /** `advance` moves focus to the next open conflict, as the keys do. */
  onResolve: (resolution: Resolution | null, advance?: boolean) => void;
  onAskAgent: () => void;
  onAcceptProposal: () => void;
  onDismissProposal: () => void;
}

/** One conflict: your side, the incoming side, the original one key away, and the choice. */
export function ConflictCard({
  conflict,
  ordinal,
  total,
  labels,
  lineNos,
  resolution,
  autoReason,
  proposal,
  proposalCheck,
  origin,
  focused,
  showOriginal,
  bothFirst,
  cardRef,
  onFocus,
  onToggleOriginal,
  onBothFirstChange,
  onResolve,
  onAskAgent,
  onAcceptProposal,
  onDismissProposal,
}: ConflictCardProps) {
  const headingId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  // Ages are read once per card: "3 days ago" does not need to tick.
  const [now] = useState(() => Date.now());
  const selfRef = useRef<HTMLElement | null>(null);
  // Whatever removes or disables the focused control hands focus to the card,
  // never to body: the keyboard keeps working from where the reader is.
  const focusSelf = () => selfRef.current?.focus({ preventScroll: true });
  const spans = pairedWordSpans(conflict.ours, conflict.theirs);
  const resolved = resolution !== undefined;

  const openEditor = (lines: string[]) => setEditing(lines.join('\n'));
  const saveEdit = (lines: string[]) => {
    setEditing(null);
    onResolve({ kind: 'custom', lines, source: 'manual' }, true);
  };
  const cancelEdit = () => {
    setEditing(null);
    focusSelf();
  };

  return (
    <section
      ref={(el) => {
        selfRef.current = el;
        cardRef?.(el);
      }}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-testid={`conflict-card-${conflict.index}`}
      data-focused={focused ? 'true' : undefined}
      data-resolved={resolved ? 'true' : undefined}
      onFocus={onFocus}
      onMouseDown={onFocus}
      className={`@container scroll-my-16 rounded-lg border bg-panel-bg outline-none transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none ${
        focused
          ? 'border-primary/60 shadow-[0_0_0_1px_rgba(var(--primary-rgb),0.35)]'
          : 'border-border-dark'
      }`}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <h3 id={headingId} className="text-[11px] font-semibold text-foreground">
          Conflict {ordinal} of {total}
        </h3>
        {resolved ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300">
            <AuricIcon name="check_circle" className="text-xs" />
            Resolved
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300">
            <AuricIcon name="radio_button_unchecked" className="text-xs" />
            Open
          </span>
        )}
        {!resolved && (
          <button
            type="button"
            aria-pressed={showOriginal}
            aria-keyshortcuts={ariaKeyshortcuts(['⌥', 'o'])}
            onClick={onToggleOriginal}
            className="ml-auto inline-flex min-h-6 items-center gap-1 rounded px-2 py-0.5 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="history" className="text-xs" />
            {showOriginal ? 'Hide original' : 'Show original'} <Kbd>⌥O</Kbd>
          </button>
        )}
      </header>

      <div className="space-y-2 px-3 pb-3">
        {resolved ? (
          <ResolvedBody
            conflict={conflict}
            resolution={resolution}
            labels={labels}
            autoReason={autoReason}
            editing={editing}
            ordinal={ordinal}
            onUndo={() => {
              onResolve(null);
              focusSelf();
            }}
            onEdit={() => openEditor(resolutionLines(conflict, resolution))}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
          />
        ) : (
          <>
            {showOriginal && <OriginalPane base={conflict.base} />}
            <div className="grid grid-cols-1 gap-2 @min-[720px]:grid-cols-2">
              <SidePane
                side="ours"
                labels={labels}
                lines={conflict.ours}
                firstLineNo={lineNos.ours}
                spans={spans?.ours}
                shortcut="⌥←"
                origin={origin?.ours}
                now={now}
              />
              <SidePane
                side="theirs"
                labels={labels}
                lines={conflict.theirs}
                firstLineNo={lineNos.theirs}
                spans={spans?.theirs}
                shortcut="⌥→"
                origin={origin?.theirs}
                now={now}
              />
            </div>
            {proposal && editing === null && (
              <ProposalBlock
                proposal={proposal}
                check={proposalCheck}
                onAccept={onAcceptProposal}
                onEdit={openEditor}
                onDismiss={() => {
                  onDismissProposal();
                  focusSelf();
                }}
                onRetry={() => {
                  onAskAgent();
                  focusSelf();
                }}
              />
            )}
            {editing !== null ? (
              <Editor ordinal={ordinal} initial={editing} onSave={saveEdit} onCancel={cancelEdit} />
            ) : (
              <UnresolvedActions
                labels={labels}
                bothFirst={bothFirst}
                asking={proposal?.status === 'loading'}
                onResolve={onResolve}
                onBothFirstChange={onBothFirstChange}
                onEdit={() => openEditor(conflict.ours)}
                onAskAgent={() => {
                  onAskAgent();
                  focusSelf();
                }}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function UnresolvedActions({
  labels,
  bothFirst,
  asking,
  onResolve,
  onBothFirstChange,
  onEdit,
  onAskAgent,
}: {
  labels: SideLabels;
  bothFirst: Side;
  asking: boolean;
  onResolve: (resolution: Resolution, advance: boolean) => void;
  onBothFirstChange: (side: Side) => void;
  onEdit: () => void;
  onAskAgent: () => void;
}) {
  const other: Side = bothFirst === 'ours' ? 'theirs' : 'ours';
  const firstName = bothFirst === 'ours' ? labels.ours : labels.theirs;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Resolve this conflict"
    >
      <button
        type="button"
        onClick={() => onResolve({ kind: 'ours' }, true)}
        aria-keyshortcuts={ariaKeyshortcuts(['⌥', '←'])}
        className={ACTION_BUTTON}
      >
        <AuricIcon name={SIDE_STYLE.ours.icon} className="text-xs text-sky-300" />
        Take {roleOf(labels, 'ours')} <Kbd>⌥←</Kbd>
      </button>
      <button
        type="button"
        onClick={() => onResolve({ kind: 'theirs' }, true)}
        aria-keyshortcuts={ariaKeyshortcuts(['⌥', '→'])}
        className={ACTION_BUTTON}
      >
        <AuricIcon name={SIDE_STYLE.theirs.icon} className="text-xs text-orange-300" />
        Take {roleOf(labels, 'theirs')} <Kbd>⌥→</Kbd>
      </button>
      <span className="inline-flex">
        <button
          type="button"
          onClick={() => onResolve({ kind: 'both', first: bothFirst }, true)}
          aria-keyshortcuts={ariaKeyshortcuts(['⌥', 'b'])}
          title={`Keep both sides, ${firstName} first`}
          className={`${ACTION_BUTTON} rounded-r-none`}
        >
          Both, {roleOf(labels, bothFirst)} first <Kbd>⌥B</Kbd>
        </button>
        <button
          type="button"
          aria-label="Swap order"
          title={`Put ${roleOf(labels, other)} first`}
          onClick={() => onBothFirstChange(other)}
          className={`${ACTION_BUTTON} -ml-px min-w-7 justify-center rounded-l-none px-1.5`}
        >
          <AuricIcon name="sync" aria-hidden="true" className="text-xs" />
        </button>
      </span>
      <button type="button" onClick={onEdit} className={ACTION_BUTTON}>
        <AuricIcon name="edit" className="text-xs" />
        Edit
      </button>
      <button
        type="button"
        onClick={onAskAgent}
        disabled={asking}
        aria-keyshortcuts={ariaKeyshortcuts(['⌥', 'a'])}
        className={`${ACTION_BUTTON} ml-auto`}
      >
        <AuricIcon name="smart_toy" className="text-xs text-primary-light" />
        Ask agent <Kbd>⌥A</Kbd>
      </button>
    </div>
  );
}

function ResolvedBody({
  conflict,
  resolution,
  labels,
  autoReason,
  editing,
  ordinal,
  onUndo,
  onEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  conflict: ConflictSegment;
  resolution: Resolution;
  labels: SideLabels;
  autoReason: string | undefined;
  editing: string | null;
  ordinal: number;
  onUndo: () => void;
  onEdit: () => void;
  onSaveEdit: (lines: string[]) => void;
  onCancelEdit: () => void;
}) {
  if (editing !== null) {
    return (
      <Editor ordinal={ordinal} initial={editing} onSave={onSaveEdit} onCancel={onCancelEdit} />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium text-foreground" data-testid="resolution-summary">
          {resolutionSummary(resolution, labels)}
        </span>
        {autoReason && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-foreground-muted"
            data-testid="auto-reason"
          >
            <AuricIcon name="auto_fix_high" className="text-xs text-primary-light" />
            {autoReason}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={onEdit} className={ACTION_BUTTON}>
            <AuricIcon name="edit" className="text-xs" />
            Edit
          </button>
          <button type="button" onClick={onUndo} className={ACTION_BUTTON}>
            <AuricIcon name="undo" className="text-xs" />
            Undo
          </button>
        </span>
      </div>
      <div className="rounded-md border border-border-dark bg-editor-bg/60">
        <CodeLines
          lines={resolutionLines(conflict, resolution)}
          emptyText="These lines are removed."
        />
      </div>
    </>
  );
}
