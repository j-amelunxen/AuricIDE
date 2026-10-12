'use client';

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { statusBadge } from '@/app/components/git/sourceControl/types';
import {
  HunkHeaderContext,
  type HunkHeaderApi,
} from '@/app/components/editor/diff/HunkHeaderContext';
import { HunkToolbar } from '@/app/components/editor/diff/HunkToolbar';
import { LineCommentContext } from '@/app/components/editor/diff/LineCommentContext';
import { LineEditContext } from '@/app/components/editor/diff/LineEditContext';
import { RiskChips } from '@/app/components/editor/diff/RiskChips';
import { SideBySideView } from '@/app/components/editor/diff/SideBySideView';
import { UnifiedView } from '@/app/components/editor/diff/UnifiedView';
import { hunkCommentTarget, type LineEditApi } from '@/app/components/editor/diff/types';
import { useLineCommentApi } from '@/app/components/editor/diff/useLineCommentApi';
import { parseDiff } from '@/lib/git/parseDiff';
import { fileLevelFlags, flagsForHunk } from '@/lib/git/review/riskChips';
import type { ReviewFile, ViewedState } from '@/lib/git/review/reviewSession';
import { hunkCountOf } from '@/lib/git/review/reviewFocus';
import {
  useWorktreeHunks,
  type ReviewActionOutcome,
  type ReviewHunkKeys,
} from './useWorktreeHunks';
import type { ReviewComposerOpener } from './useReviewNavigation';

export type ReviewViewMode = 'unified' | 'side-by-side';

/** Lines are not edited inside a review: the reviewer judges, the agent rewrites. */
const NO_EDIT: LineEditApi = {
  canEditFile: false,
  edit: null,
  saving: false,
  startEdit: () => {},
  setDraft: () => {},
  commitEdit: () => {},
  cancelEdit: () => {},
};

const VIEWED_NOTE: Record<ViewedState, string | null> = {
  unviewed: null,
  viewed: null,
  'changed-since-viewed': 'Changed since you viewed it',
};

export interface ReviewFileSectionProps {
  tabId: string;
  repoPath: string;
  file: ReviewFile;
  viewed: ViewedState;
  collapsed: boolean;
  /** The file the reviewer is on: its hunk actions rest half visible instead of hidden. */
  current: boolean;
  /** The focused hunk of this file, or `null` when focus is elsewhere. */
  focusedHunk: number | null;
  /** Accept and discard are offered for working-tree sessions only. */
  actionable: boolean;
  viewMode: ReviewViewMode;
  onToggleCollapsed: (path: string) => void;
  onToggleViewed: (path: string) => void;
  /** Focus arrived here by pointer or Tab; `hunk` is `null` for the header. Moves nothing. */
  onFocusStop: (path: string, hunk: number | null) => void;
  onHunkActed: (path: string, hunk: number, outcome: ReviewActionOutcome) => void;
  onFileActed: (path: string, outcome: ReviewActionOutcome) => void;
  onCommentDone: (path: string, outcome: 'saved' | 'cancelled') => void;
  registerKeys: (path: string, keys: ReviewHunkKeys | null) => void;
  /** Lets `C` open this file's comment composer on a hunk. */
  registerComposer: (path: string, open: ReviewComposerOpener | null) => void;
}

type WorktreeHunks = ReturnType<typeof useWorktreeHunks>;

type PatchProps = Pick<
  ReviewFileSectionProps,
  | 'repoPath'
  | 'file'
  | 'actionable'
  | 'viewMode'
  | 'current'
  | 'focusedHunk'
  | 'onCommentDone'
  | 'registerComposer'
> & {
  worktree: WorktreeHunks;
};

/** The hunk a focused element belongs to: its own header row, or the last one before it. */
function hunkRowOf(section: HTMLElement, target: HTMLElement): Element | null {
  if (target.closest('[data-review-header]')) return null;
  const own = target.closest('[data-hunk-index]');
  if (own) return own;
  let before: Element | null = null;
  for (const row of section.querySelectorAll('[data-hunk-index]')) {
    if (row.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) before = row;
  }
  return before;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// code-gate: complexity-parameter-count - one destructured props object, named at the call site
function ReviewPatch({
  repoPath,
  file,
  actionable,
  viewMode,
  current,
  focusedHunk,
  onCommentDone,
  registerComposer,
  worktree,
}: PatchProps) {
  // The section header already names the file; git's `---`/`+++` lines would only repeat it.
  const lines = useMemo(
    () => parseDiff(file.patch).filter((l) => l.type !== 'header' || l.content.startsWith('@@')),
    [file.patch]
  );
  const hunkCount = useMemo(() => hunkCountOf(file.patch), [file.patch]);
  const commentDone = useCallback(
    (outcome: 'saved' | 'cancelled') => onCommentDone(file.path, outcome),
    [file.path, onCommentDone]
  );
  const lineComment = useLineCommentApi(repoPath, file.path, commentDone);
  const { hunkActions, busy } = worktree;
  const { startDraft } = lineComment;

  useEffect(() => {
    registerComposer(file.path, (hunk) => {
      const target = hunkCommentTarget(lines, hunk);
      if (target) startDraft(target);
      return !!target;
    });
    return () => registerComposer(file.path, null);
  }, [file.path, lines, registerComposer, startDraft]);

  const hunkHeader = useMemo<HunkHeaderApi>(
    () => ({
      focusedHunk,
      describeHunk: (hunkIndex) =>
        `Hunk ${hunkIndex + 1} of ${hunkCount} in ${basename(file.path)}`,
      renderHunkHeader: (hunkIndex) => {
        const { actions, note } = actionable
          ? hunkActions(hunkIndex)
          : { actions: [], note: undefined };
        return (
          <HunkToolbar
            hunkIndex={hunkIndex}
            hunkCount={hunkCount}
            fileName={file.path}
            flags={flagsForHunk(file.flags, hunkIndex)}
            actions={actions}
            note={note}
            visibility={hunkIndex === focusedHunk ? 'focused' : current ? 'dim' : 'hover'}
            busy={busy}
          />
        );
      },
    }),
    [actionable, busy, current, file.flags, file.path, focusedHunk, hunkActions, hunkCount]
  );

  return (
    <>
      {actionable && worktree.fallbackReason ? (
        <p
          data-testid="review-hunk-fallback"
          className="border-b border-border-dark px-3 py-1 text-[11px] text-foreground-muted"
        >
          {worktree.fallbackReason}
        </p>
      ) : null}
      <LineCommentContext.Provider value={lineComment}>
        <LineEditContext.Provider value={NO_EDIT}>
          <HunkHeaderContext.Provider value={hunkHeader}>
            {viewMode === 'unified' ? (
              <UnifiedView lines={lines} scroll={false} />
            ) : (
              <SideBySideView lines={lines} scroll={false} />
            )}
          </HunkHeaderContext.Provider>
        </LineEditContext.Provider>
      </LineCommentContext.Provider>
    </>
  );
}

function SectionBody(props: PatchProps) {
  const { file } = props;
  if (file.status === 'conflicted') {
    return (
      <p className="px-4 py-3 text-xs text-foreground-muted">
        This file has a merge conflict. Resolve it in the merge panel, then review it here.
      </p>
    );
  }
  if (file.loadError) {
    return (
      <p role="alert" className="px-4 py-3 text-xs text-red-300">
        Could not read this file&apos;s changes: {file.loadError}
      </p>
    );
  }
  if (!file.patch.trim()) {
    return <p className="px-4 py-3 text-xs text-foreground-muted">No text changes to show.</p>;
  }
  return <ReviewPatch {...props} />;
}

const FILE_ACTION =
  'flex min-h-6 items-center gap-1 rounded px-2 font-medium motion-safe:active:scale-[0.96] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Whole-file accept and discard. They show on hover and keyboard focus of the header. */
function FileActions({ worktree }: { worktree: WorktreeHunks }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[11px] opacity-0 transition-opacity duration-150 group-focus-within/header:opacity-100 group-hover/header:opacity-100 motion-reduce:transition-none">
      {worktree.canAccept ? (
        <button
          type="button"
          data-testid="review-accept-file"
          title="Stages the whole file. Unstage it in Source Control to undo."
          disabled={worktree.busy}
          onClick={() => void worktree.runFile('accept')}
          className={`${FILE_ACTION} text-foreground hover:bg-primary/15 hover:text-primary-light`}
        >
          <AuricIcon name="check" className="text-[13px]" />
          Accept file
        </button>
      ) : null}
      <button
        type="button"
        data-testid="review-discard-file"
        title="Throws away every change to this file. Asks first; cannot be undone."
        disabled={worktree.busy}
        onClick={() => void worktree.runFile('discard')}
        className={`${FILE_ACTION} text-foreground-muted hover:bg-red-500/10 hover:text-red-300`}
      >
        <AuricIcon name="undo" className="text-[13px]" />
        Discard file
      </button>
    </span>
  );
}

// code-gate: complexity-parameter-count - one destructured props object, named at the call site
function ReviewFileHeader({
  file,
  viewed,
  collapsed,
  current,
  headingId,
  fileActions,
  onToggleCollapsed,
  onToggleViewed,
}: Pick<ReviewFileSectionProps, 'file' | 'viewed' | 'collapsed' | 'current'> & {
  headingId: string;
  fileActions: ReactNode;
  onToggleCollapsed: () => void;
  onToggleViewed: () => void;
}) {
  const badge = statusBadge[file.status] ?? statusBadge.untracked;
  const fileFlags = useMemo(() => fileLevelFlags(file.flags), [file.flags]);
  const note = VIEWED_NOTE[viewed];
  return (
    <header
      data-review-header=""
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`group/header sticky top-0 z-10 flex items-center gap-2 border-b border-border-dark bg-editor-bg px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${
        current ? 'shadow-[inset_0_-1px_0_var(--primary)]' : ''
      }`}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
        onClick={onToggleCollapsed}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <AuricIcon
          name="chevron_right"
          className={`text-sm transition-transform duration-150 motion-reduce:transition-none ${
            collapsed ? '' : 'rotate-90'
          }`}
        />
      </button>
      <span
        className={`w-3 shrink-0 text-center font-mono text-[11px] font-bold ${badge.className}`}
      >
        {badge.label}
      </span>
      <h3
        id={headingId}
        className="min-w-0 truncate font-mono text-xs text-foreground"
        title={file.path}
      >
        {file.path}
      </h3>
      <RiskChips flags={fileFlags} />
      {note ? (
        <span
          data-testid="review-changed-note"
          className="shrink-0 text-[11px] font-medium text-amber-400"
        >
          {note}
        </span>
      ) : null}
      <span className="ml-auto" />
      {fileActions}
      <label className="flex min-h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground">
        <input
          type="checkbox"
          data-testid="review-viewed-toggle"
          aria-keyshortcuts="V"
          checked={viewed === 'viewed'}
          onChange={onToggleViewed}
          className="h-3.5 w-3.5 accent-[var(--primary)]"
        />
        Viewed
      </label>
    </header>
  );
}

/**
 * One file of the change set: a sticky header, and its patch unless collapsed.
 * Memoised: with hundreds of files, a change to one must not render the rest.
 */
export const ReviewFileSection = memo(function ReviewFileSection(props: ReviewFileSectionProps) {
  const { tabId, repoPath, file, collapsed, actionable } = props;
  const { onFocusStop, onHunkActed, onFileActed, registerKeys } = props;
  const headingId = useId();
  const hunkActed = useCallback(
    (hunk: number, outcome: ReviewActionOutcome) => onHunkActed(file.path, hunk, outcome),
    [file.path, onHunkActed]
  );
  const fileActed = useCallback(
    (outcome: ReviewActionOutcome) => onFileActed(file.path, outcome),
    [file.path, onFileActed]
  );
  // Side patches are read only while the patch is on screen; a folded file costs nothing.
  const worktree = useWorktreeHunks({
    tabId,
    repoPath,
    file,
    enabled: actionable && !collapsed,
    onHunkActed: hunkActed,
    onFileActed: fileActed,
  });

  useEffect(() => {
    registerKeys(file.path, worktree.keys);
    return () => registerKeys(file.path, null);
  }, [file.path, registerKeys, worktree.keys]);

  const followFocus = (event: FocusEvent<HTMLElement>) => {
    const row = hunkRowOf(event.currentTarget, event.target as HTMLElement);
    const hunk = row ? Number(row.getAttribute('data-hunk-index')) : null;
    onFocusStop(file.path, hunk !== null && Number.isFinite(hunk) ? hunk : null);
  };

  const fileActions =
    actionable && file.status !== 'conflicted' ? <FileActions worktree={worktree} /> : null;

  return (
    <section
      data-testid="review-file-section"
      data-review-path={file.path}
      aria-labelledby={headingId}
      onFocus={followFocus}
      className="border-b border-border-dark"
    >
      <ReviewFileHeader
        {...props}
        headingId={headingId}
        fileActions={fileActions}
        onToggleCollapsed={() => props.onToggleCollapsed(file.path)}
        onToggleViewed={() => props.onToggleViewed(file.path)}
      />
      {collapsed ? null : <SectionBody {...props} worktree={worktree} />}
      {worktree.confirmDialog}
    </section>
  );
});
