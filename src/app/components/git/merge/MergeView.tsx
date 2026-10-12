'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import {
  autoResolution,
  composeResult,
  hasConflictMarkers,
  isMarkerLine,
  type CleanSegment,
  type Resolution,
} from '@/lib/git/merge/conflictModel';
import {
  checkProposalSyntax,
  checkResolvedFile,
  describeSyntaxCheck,
  type SyntaxCheck,
} from '@/lib/git/merge/syntaxCheck';
import { useStore } from '@/lib/store';
import {
  selectMergeDoc,
  unresolvedConflictIndexes,
  type MergeDocState,
  type SidePick,
} from '@/lib/store/mergeSlice';
import { ConflictCard } from './ConflictCard';
import { MergeToolbar } from './MergeToolbar';
import {
  conflictsOf,
  foldClean,
  pickExplanation,
  pickOptions,
  pluralize,
  resolutionSummary,
  segmentLineNumbers,
  type Side,
  labelsFor,
  operationCopy,
  resolutionBreakdown,
  roleOf,
  type SideLabels,
} from './mergeCopy';
import { OperationHeadline } from './OperationHeadline';
import { useShortcutSheet, type ShortcutSheetContent } from '../shared/ShortcutSheet';
import { isShortcutSheetKey } from '../shared/shortcutKeys';
import type { GitOperation } from '@/lib/tauri/gitMerge';
import { openMergeTabOrToast } from '@/lib/ide/openMergeTab';

export interface MergeViewProps {
  tabId: string;
  /** Shows the Source Control panel, where the merge is committed. */
  onOpenSourceControl?: () => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/** The tab for one conflicted file. See `docs/design-merge-panel.md`. */
export function MergeView({ tabId, onOpenSourceControl }: MergeViewProps) {
  const selectDoc = useMemo(() => selectMergeDoc(tabId), [tabId]);
  const doc = useStore(selectDoc);

  if (!doc) {
    return (
      <CalmState icon="merge" title="This file is no longer open in a merge">
        <p>Open it again from Source Control.</p>
        {onOpenSourceControl && (
          <button type="button" onClick={onOpenSourceControl} className={SECONDARY}>
            Open Source Control
          </button>
        )}
      </CalmState>
    );
  }
  if (doc.ended) return <EndedState tabId={tabId} onOpenSourceControl={onOpenSourceControl} />;
  if (doc.resolved) return <DoneState doc={doc} onOpenSourceControl={onOpenSourceControl} />;
  if (!doc.doc) return <PickSideView tabId={tabId} doc={doc} />;
  if (doc.doc.segments.some((seg) => seg.kind === 'unparsed')) {
    return <ManualView tabId={tabId} doc={doc} />;
  }
  return <ConflictsView tabId={tabId} doc={doc} />;
}

const SECONDARY =
  'inline-flex items-center gap-1.5 rounded border border-border-dark px-3 py-1.5 text-xs font-medium text-foreground transition-[transform,background-color,border-color] duration-100 ease-out hover:border-primary/40 hover:bg-primary/10 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transition-none';

const PRIMARY =
  'inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none';

function CalmState({
  icon,
  iconClass = 'text-foreground-muted',
  title,
  children,
}: {
  icon: string;
  iconClass?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-editor-bg p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center text-xs text-foreground-muted">
        <AuricIcon name={icon} className={`text-2xl ${iconClass}`} />
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function useOperation(doc: MergeDocState): GitOperation | undefined {
  return useStore((s) => s.mergeStates[doc.repoPath]?.operation);
}

/** Side names for the operation in progress: a rebase calls its sides something else. */
function useLabels(doc: MergeDocState): SideLabels {
  const operation = useOperation(doc);
  return labelsFor(doc.file.oursLabel, doc.file.theirsLabel, operation);
}

/**
 * The merge this doc belonged to was concluded, aborted or replaced, here or
 * in a terminal. Nothing here can be written any more, so the only actions
 * are leaving.
 */
function EndedState({
  tabId,
  onOpenSourceControl,
}: {
  tabId: string;
  onOpenSourceControl?: () => void;
}) {
  const closeTab = useStore((s) => s.closeTab);
  return (
    <CalmState icon="merge" title="This conflict is closed">
      <p>
        Git moved past it, here or in a terminal. If the file still has a conflict, open it again
        from Source Control.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          // The view was replaced under the reader; closing is the obvious next step.
          autoFocus
          onClick={() => closeTab(tabId)}
          className={PRIMARY}
        >
          Close
        </button>
        {onOpenSourceControl && (
          <button type="button" onClick={onOpenSourceControl} className={SECONDARY}>
            Open Source Control
          </button>
        )}
      </div>
    </CalmState>
  );
}

function DoneState({
  doc,
  onOpenSourceControl,
}: {
  doc: MergeDocState;
  onOpenSourceControl?: () => void;
}) {
  const mergeState = useStore((s) => s.mergeStates[doc.repoPath]);
  const remaining = (mergeState?.conflicts ?? []).filter((c) => c.path !== doc.filePath);
  const next = remaining[0];
  const name = doc.filePath.split('/').pop();
  const finish = operationCopy(mergeState?.operation).continueLabel;
  const labels = useLabels(doc);
  const breakdown = resolutionBreakdown(doc.resolutions, doc.autoReasons, labels);
  return (
    <CalmState icon="check_circle" iconClass="text-emerald-400" title={`${name} is resolved`}>
      <p>The result was written and staged. Nothing is committed yet.</p>
      {breakdown && (
        <p className="text-foreground" data-testid="resolution-breakdown">
          {breakdown}
        </p>
      )}
      {next ? (
        <>
          <button
            type="button"
            // The view just changed under the reader; the next step is the obvious target.
            autoFocus
            onClick={() => openMergeTabOrToast(doc.repoPath, next.path)}
            className={PRIMARY}
          >
            Next conflicted file
            <span className="max-w-[16rem] truncate font-mono text-[11px] text-white/80">
              {next.path}
            </span>
          </button>
          <p className="text-[11px]">{pluralize(remaining.length, 'file', 'files')} left</p>
        </>
      ) : finish ? (
        <>
          <p className="text-foreground" data-testid="finish-hint">
            All files are resolved. Press <strong className="font-medium">{finish}</strong> in
            Source Control.
          </p>
          {onOpenSourceControl && (
            <button type="button" autoFocus onClick={onOpenSourceControl} className={PRIMARY}>
              <AuricIcon name="commit" className="text-sm" />
              Open Source Control
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-foreground">
            All files are resolved. Commit the merge in Source Control.
          </p>
          {onOpenSourceControl && (
            <button type="button" onClick={onOpenSourceControl} className={PRIMARY}>
              <AuricIcon name="commit" className="text-sm" />
              Open Source Control
            </button>
          )}
        </>
      )}
    </CalmState>
  );
}

/**
 * Writes and stages the file. `busy` stays set after a success on purpose:
 * the store marks the document resolved and the done state replaces the view.
 */
function useResolveFile(tabId: string, filePath: string) {
  const resolveFile = useStore((s) => s.resolveFile);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const run = async (pick?: SidePick) => {
    if (busy) return;
    setBusy(true);
    try {
      await (pick ? resolveFile(tabId, pick) : resolveFile(tabId));
    } catch (err) {
      showToast(`Could not resolve ${filePath}: ${errorText(err)}`, 'error');
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * Mark resolved checks the file once more before writing it. A file that would
 * not parse costs one extra press, with the reason shown; it is never refused.
 * The warning belongs to the text it was raised for, so any change asks again.
 */
function useSyntaxGate(doc: MergeDocState, text: string | null) {
  const [raised, setRaised] = useState<{ check: SyntaxCheck; text: string } | null>(null);
  const warning = raised !== null && raised.text === text ? raised.check : null;
  /** True when the write may go ahead now. */
  const pass = (): boolean => {
    if (text === null || warning) return true;
    const check = checkResolvedFile(doc.filePath, text, [doc.file.ours, doc.file.theirs]);
    if (check.kind !== 'problem') return true;
    setRaised({ check, text });
    return false;
  };
  return { warning, pass };
}

function PickSideView({ tabId, doc }: { tabId: string; doc: MergeDocState }) {
  const labels = useLabels(doc);
  const operation = useOperation(doc);
  const { confirm, confirmDialog } = useConfirm();
  const { busy, run } = useResolveFile(tabId, doc.filePath);

  const pick = async (choice: SidePick, deletes: boolean) => {
    if (deletes) {
      const ok = await confirm({
        title: 'Delete this file?',
        message: `${doc.filePath} will be removed and the deletion staged. The other version stays in the history of ${choice === 'theirs' ? labels.ours : labels.theirs}.`,
        confirmLabel: 'Delete file',
        variant: 'destroy',
      });
      if (!ok) return;
    }
    await run(choice);
  };

  return (
    <div className="flex h-full flex-col bg-editor-bg" data-testid="merge-view">
      <MergeHeaderOnly filePath={doc.filePath} labels={labels} operation={operation} />
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
        <div className="w-full max-w-lg space-y-3 rounded-lg border border-border-dark bg-panel-bg p-4">
          <p className="text-xs leading-relaxed text-foreground">
            {pickExplanation(doc.file.kind, labels)}
          </p>
          <div className="flex flex-wrap gap-2">
            {pickOptions(doc.file.kind, labels).map((option) => (
              <button
                key={option.pick}
                type="button"
                disabled={busy}
                onClick={() => void pick(option.pick, option.deletes)}
                className={option.deletes ? SECONDARY : PRIMARY}
              >
                {option.deletes && <AuricIcon name="delete" className="text-sm" />}
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-foreground-muted">
            Your choice is written and staged right away. Nothing is committed.
          </p>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

function MergeHeaderOnly({
  filePath,
  labels,
  operation,
}: {
  filePath: string;
  labels: SideLabels;
  operation: GitOperation | undefined;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2.5">
      <AuricIcon name="merge" className="text-sm text-primary-light" />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-foreground">{filePath}</p>
        <OperationHeadline labels={labels} operation={operation} />
      </div>
    </div>
  );
}

function ManualView({ tabId, doc }: { tabId: string; doc: MergeDocState }) {
  const setManualText = useStore((s) => s.setManualText);
  const reasonId = useId();
  const labels = useLabels(doc);
  const operation = useOperation(doc);
  const { busy, run } = useResolveFile(tabId, doc.filePath);
  const raw = doc.doc?.segments[0]?.kind === 'unparsed' ? doc.doc.segments[0].text : '';
  const text = doc.manualText ?? raw;
  const markerLines = text.split('\n').filter((line) => isMarkerLine(line)).length;
  const blocked = hasConflictMarkers(text);
  const canMark = doc.manualText !== null && !blocked;
  const gate = useSyntaxGate(doc, doc.manualText);

  const markResolved = async () => {
    if (canMark && gate.pass()) await run();
  };

  return (
    <div className="flex h-full flex-col bg-editor-bg" data-testid="merge-view">
      <MergeHeaderOnly filePath={doc.filePath} labels={labels} operation={operation} />
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
        <p className="flex items-start gap-2 rounded-md border border-border-dark bg-panel-bg px-3 py-2 text-[11px] leading-relaxed text-foreground-muted">
          <AuricIcon name="info" className="mt-px shrink-0 text-xs" />
          <span>
            The conflict markers in this file are not in a shape the panel can read for certain, so
            it shows the file as git wrote it rather than guess. Edit it until no marker line is
            left, then mark it resolved.
          </span>
        </p>
        <textarea
          aria-label={`Contents of ${doc.filePath}`}
          value={text}
          spellCheck={false}
          onChange={(e) => setManualText(tabId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void markResolved();
            }
          }}
          className="min-h-0 flex-1 resize-none rounded-md border border-border-dark bg-editor-bg p-3 font-mono text-xs leading-5 text-foreground focus:border-primary focus:outline-none"
        />
        <div className="flex items-center justify-end gap-3">
          <span
            id={reasonId}
            className={`text-[11px] ${gate.warning ? 'text-amber-200' : 'text-foreground-muted'}`}
            data-testid="mark-resolved-reason"
          >
            {gate.warning
              ? `${describeSyntaxCheck(gate.warning)}. Press again to mark it resolved anyway.`
              : blocked
                ? `${pluralize(markerLines, 'marker line', 'marker lines')} left`
                : doc.manualText === null
                  ? 'Edit the text to resolve it'
                  : 'No markers left'}
          </span>
          <button
            type="button"
            onClick={() => void markResolved()}
            disabled={!canMark || busy}
            aria-describedby={reasonId}
            aria-keyshortcuts="Meta+Enter"
            className={PRIMARY}
          >
            {busy ? 'Saving…' : gate.warning ? 'Mark resolved anyway' : 'Mark resolved'}
            <kbd aria-hidden="true" className="font-sans text-[10px] text-white">
              ⌘↵
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function CleanRun({
  segment,
  firstLineNo,
  position,
  expanded,
  onExpand,
}: {
  segment: CleanSegment;
  firstLineNo: number;
  position: { first: boolean; last: boolean };
  expanded: boolean;
  onExpand: () => void;
}) {
  const view = foldClean(segment.lines, firstLineNo, position);
  const shown = expanded ? [...view.head, ...view.hidden, ...view.tail] : null;
  const renderLines = (lines: { text: string; lineNo: number }[]) =>
    lines.map((line) => (
      <div key={line.lineNo} className="flex min-w-max">
        <span className="w-10 shrink-0 select-none pr-2 text-right text-foreground-muted/80">
          {line.lineNo}
        </span>
        <span className="whitespace-pre pr-3 text-foreground-muted">{line.text || ' '}</span>
      </div>
    ));
  if (segment.lines.length === 0) return null;
  return (
    <div className="overflow-x-auto px-3.5 font-mono text-xs leading-5" data-testid="clean-run">
      {shown ? (
        renderLines(shown)
      ) : (
        <>
          {renderLines(view.head)}
          {view.hidden.length > 0 && (
            <button
              type="button"
              onClick={onExpand}
              className="my-0.5 flex w-full items-center gap-1.5 rounded px-2 py-0.5 font-sans text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <AuricIcon name="expand_more" className="text-xs" />
              Show {pluralize(view.hidden.length, 'unchanged line', 'unchanged lines')}
            </button>
          )}
          {renderLines(view.tail)}
        </>
      )}
    </div>
  );
}

function nextIn(order: number[], from: number | null, dir: 1 | -1): number | null {
  if (order.length === 0) return null;
  if (from === null) return dir === 1 ? order[0] : order[order.length - 1];
  const after =
    dir === 1 ? order.find((i) => i > from) : [...order].reverse().find((i) => i < from);
  return after ?? (dir === 1 ? order[0] : order[order.length - 1]);
}

const ALT_KEYS: Record<string, 'ours' | 'theirs' | 'both' | 'original' | 'ask'> = {
  ArrowLeft: 'ours',
  ArrowRight: 'theirs',
  KeyB: 'both',
  KeyO: 'original',
  KeyA: 'ask',
};

function mergeShortcuts(labels: SideLabels): ShortcutSheetContent {
  return {
    title: 'Merge shortcuts',
    groups: [
      {
        label: 'Move',
        items: [
          { keys: ['⌥', '↓'], action: 'Next open conflict' },
          { keys: ['⌥', '↑'], action: 'Previous open conflict' },
        ],
      },
      {
        label: 'Resolve the focused conflict',
        items: [
          { keys: ['⌥', '←'], action: `Take ${roleOf(labels, 'ours')}` },
          { keys: ['⌥', '→'], action: `Take ${roleOf(labels, 'theirs')}` },
          { keys: ['⌥', 'B'], action: 'Both' },
          { keys: ['⌥', 'O'], action: 'Show or hide the original' },
          { keys: ['⌥', 'A'], action: 'Ask agent' },
        ],
      },
      {
        label: 'File',
        items: [
          { keys: ['⌘', '↵'], action: 'Mark resolved' },
          { keys: ['?'], action: 'Show these shortcuts' },
        ],
      },
    ],
  };
}

// code-gate: complexity-function-length - one view's state, keyboard map and render; split further it would pass a dozen props around
function ConflictsView({ tabId, doc }: { tabId: string; doc: MergeDocState }) {
  const setResolution = useStore((s) => s.setResolution);
  const autoResolveAll = useStore((s) => s.autoResolveAll);
  const requestProposal = useStore((s) => s.requestProposal);
  const acceptProposal = useStore((s) => s.acceptProposal);
  const dismissProposal = useStore((s) => s.dismissProposal);
  const labels = useLabels(doc);
  const operation = useOperation(doc);
  const { busy, run } = useResolveFile(tabId, doc.filePath);
  const shortcuts = useShortcutSheet(mergeShortcuts(labels));
  const segments = useMemo(() => doc.doc?.segments ?? [], [doc.doc]);

  const conflicts = useMemo(() => conflictsOf(segments), [segments]);
  const lineNumbers = useMemo(() => segmentLineNumbers(segments), [segments]);
  const unresolved = useMemo(() => unresolvedConflictIndexes(doc), [doc]);
  const simpleCount = useMemo(
    () => conflicts.filter((c) => !doc.resolutions[c.index] && autoResolution(c)).length,
    [conflicts, doc.resolutions]
  );

  const [focused, setFocused] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState<ReadonlySet<number>>(() => new Set());
  const [bothFirst, setBothFirst] = useState<Record<number, Side>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const cardRefs = useRef(new Map<number, HTMLElement>());

  const total = conflicts.length;
  const resolvedCount = total - unresolved.length;
  const canMark = unresolved.length === 0;

  const focusCard = useCallback((index: number | null) => {
    if (index === null) return;
    setFocused(index);
    const el = cardRefs.current.get(index);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, []);

  // Land on the first open conflict so the keyboard works from the first keystroke.
  const landedRef = useRef(false);
  useEffect(() => {
    if (landedRef.current) return;
    landedRef.current = true;
    focusCard(unresolved[0] ?? conflicts[0]?.index ?? null);
  }, [focusCard, unresolved, conflicts]);

  const announceResolution = (index: number, resolution: Resolution | null, left: number) => {
    const ordinal = conflicts.findIndex((c) => c.index === index) + 1;
    const what = resolution ? resolutionSummary(resolution, labels) : 'Reopened';
    const rest =
      left === 0
        ? 'All conflicts resolved. Press Command Enter to mark the file resolved.'
        : `${pluralize(left, 'conflict', 'conflicts')} left.`;
    setAnnouncement(`Conflict ${ordinal}: ${what}. ${rest}`);
  };

  const resolve = (index: number, resolution: Resolution | null, advance = false) => {
    setResolution(tabId, index, resolution);
    const remaining = unresolved.filter((i) => i !== index);
    announceResolution(index, resolution, resolution ? remaining.length : remaining.length + 1);
    if (advance && resolution) {
      focusCard(remaining.length > 0 ? nextIn(remaining, index, 1) : index);
    }
  };

  const askAgent = (index: number) => {
    void requestProposal(tabId, index);
    setAnnouncement('Asking the model for a proposal.');
  };

  const runWand = () => {
    const count = autoResolveAll(tabId);
    // The wand disables itself once nothing simple is left; focus goes to
    // the first conflict that still needs a person, never to body.
    const stillOpen = unresolvedConflictIndexes(useStore.getState().mergeDocs[tabId] ?? doc);
    focusCard(stillOpen[0] ?? focused ?? conflicts[0]?.index ?? null);
    if (count > 0) {
      setAnnouncement(
        `Resolved ${pluralize(count, 'simple conflict', 'simple conflicts')}. Each says why it was safe.`
      );
    }
  };

  const composed = useMemo(
    () => (doc.doc ? composeResult(doc.doc, doc.resolutions) : null),
    [doc.doc, doc.resolutions]
  );
  const gate = useSyntaxGate(doc, composed);
  // Each ready proposal, judged inside the file it would land in.
  const proposalChecks = useMemo(() => {
    const checks: Record<number, SyntaxCheck> = {};
    if (!doc.doc) return checks;
    for (const [key, proposal] of Object.entries(doc.proposals)) {
      if (proposal.status !== 'ready') continue;
      const index = Number(key);
      checks[index] = checkProposalSyntax(
        doc.filePath,
        doc.doc,
        doc.resolutions,
        index,
        proposal.lines
      );
    }
    return checks;
  }, [doc.doc, doc.proposals, doc.resolutions, doc.filePath]);

  const markResolved = async () => {
    if (canMark && gate.pass()) await run();
  };

  const navigate = useCallback(
    (dir: 1 | -1) => focusCard(nextIn(unresolved, focused, dir)),
    [focusCard, unresolved, focused]
  );

  // The palette's "Next/Previous Diff Hunk" (⌥↓/⌥↑ from anywhere) moves between conflicts here.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });
  useEffect(() => {
    let lastNonce = useStore.getState().hunkNavNonce;
    return useStore.subscribe((s) => {
      if (s.hunkNavNonce === lastNonce || !s.hunkNavDirection) return;
      lastNonce = s.hunkNavNonce;
      navigateRef.current(s.hunkNavDirection === 'next' ? 1 : -1);
    });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isShortcutSheetKey(e)) {
      e.preventDefault();
      shortcuts.open();
      return;
    }
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void markResolved();
      return;
    }
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      navigate(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    // Option changes e.key on macOS (⌥B is "∫"), so letters are matched by code.
    const action = ALT_KEYS[e.key] ?? ALT_KEYS[e.code];
    const target = focused ?? unresolved[0] ?? null;
    if (!action || target === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'ours') resolve(target, { kind: 'ours' }, true);
    else if (action === 'theirs') resolve(target, { kind: 'theirs' }, true);
    else if (action === 'both')
      resolve(target, { kind: 'both', first: bothFirst[target] ?? 'ours' }, true);
    else if (action === 'original') toggleOriginal(target);
    else if (!doc.resolutions[target]) askAgent(target);
  };

  const toggleOriginal = (index: number) =>
    setShowOriginal((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const blockedReason = canMark
    ? null
    : `${pluralize(unresolved.length, 'conflict', 'conflicts')} open`;
  const lastConflictPos = segments.reduce((acc, seg, i) => (seg.kind === 'conflict' ? i : acc), -1);
  const firstConflictPos = segments.findIndex((seg) => seg.kind === 'conflict');

  return (
    // The keyboard map lives on the view so it works from any card or button inside it.
    <div
      className="flex h-full flex-col bg-editor-bg"
      data-testid="merge-view"
      onKeyDown={onKeyDown}
    >
      <MergeToolbar
        filePath={doc.filePath}
        labels={labels}
        operation={operation}
        resolvedCount={resolvedCount}
        total={total}
        simpleCount={simpleCount}
        canMarkResolved={canMark}
        blockedReason={blockedReason}
        busy={busy}
        syntaxWarning={gate.warning}
        onAutoResolve={runWand}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onMarkResolved={() => void markResolved()}
      />
      {shortcuts.sheet}
      <p className="sr-only" aria-live="polite" data-testid="merge-announcer">
        {announcement}
      </p>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1280px] space-y-2 px-4 py-3">
          {total === 0 && (
            <p className="text-xs text-foreground-muted">
              Git left no conflict regions in this file. Mark it resolved to stage it as it is.
            </p>
          )}
          {segments.map((seg, pos) => {
            if (seg.kind === 'clean') {
              return (
                <CleanRun
                  key={`clean-${pos}`}
                  segment={seg}
                  firstLineNo={lineNumbers[pos].ours}
                  position={{ first: pos < firstConflictPos, last: pos > lastConflictPos }}
                  expanded={expanded.has(pos)}
                  onExpand={() => setExpanded((prev) => new Set(prev).add(pos))}
                />
              );
            }
            if (seg.kind !== 'conflict') return null;
            const proposal = doc.proposals[seg.index];
            return (
              <ConflictCard
                key={`conflict-${seg.index}`}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(seg.index, el);
                  else cardRefs.current.delete(seg.index);
                }}
                conflict={seg}
                ordinal={conflicts.indexOf(seg) + 1}
                total={total}
                labels={labels}
                lineNos={lineNumbers[pos]}
                resolution={doc.resolutions[seg.index]}
                autoReason={doc.autoReasons[seg.index]}
                proposal={proposal}
                proposalCheck={proposalChecks[seg.index]}
                origin={doc.origins?.[seg.index]}
                focused={focused === seg.index}
                showOriginal={showOriginal.has(seg.index)}
                bothFirst={bothFirst[seg.index] ?? 'ours'}
                onFocus={() => setFocused(seg.index)}
                onToggleOriginal={() => toggleOriginal(seg.index)}
                onBothFirstChange={(side) =>
                  setBothFirst((prev) => ({ ...prev, [seg.index]: side }))
                }
                onResolve={(resolution, advance) => resolve(seg.index, resolution, advance)}
                onAskAgent={() => askAgent(seg.index)}
                onAcceptProposal={() => {
                  acceptProposal(tabId, seg.index);
                  const remaining = unresolved.filter((i) => i !== seg.index);
                  announceResolution(
                    seg.index,
                    { kind: 'custom', lines: [], source: 'agent' },
                    remaining.length
                  );
                  focusCard(remaining.length > 0 ? nextIn(remaining, seg.index, 1) : seg.index);
                }}
                onDismissProposal={() => dismissProposal(tabId, seg.index)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
