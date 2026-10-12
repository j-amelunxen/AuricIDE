'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useNarrow } from '@/app/components/editor/diff/useNarrow';
import { useShortcutSheet, type ShortcutSheetContent } from '../shared/ShortcutSheet';
import { isShortcutSheetKey } from '../shared/shortcutKeys';
import { isOpenComment, sendReviewComments } from '@/app/components/editor/diff/sendReviewComments';
import { useShallow } from 'zustand/react/shallow';
import { reviewIntentFor, type ReviewIntent } from '@/lib/git/review/reviewIntent';
import { withMergeBase } from '@/lib/git/review/withMergeBase';
import { getMergeBase } from '@/lib/tauri/git';
import {
  parseReviewTabId,
  reviewProgress,
  viewedState,
  type ReviewProgress,
  type ReviewSource,
  viewedMarksKey,
} from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';
import {
  selectReviewFiles,
  selectReviewSession,
  selectViewedMarks,
  type ReviewSession,
} from '@/lib/store/reviewSlice';
import { ReviewFileList } from './ReviewFileList';
import { ReviewFileSection, type ReviewViewMode } from './ReviewFileSection';
import { ReviewIntentHeader } from './ReviewIntentHeader';
import { ReviewToolbar } from './ReviewToolbar';
import { useReviewAutoRefresh } from './useReviewAutoRefresh';
import { ReviewVerdictBar } from './ReviewVerdictBar';
import { useReviewNavigation, type ReviewEntry } from './useReviewNavigation';
import { approveKindFor, useReviewVerdict } from './useReviewVerdict';

export interface ReviewViewProps {
  tabId: string;
  /**
   * Approve on a working-tree session: show the Source Control commit box for
   * this repo. The IDE shell owns the sidebar, so it is passed in.
   */
  onApproveWorkingTree?: (repoPath: string) => void;
}

function refresh(tabId: string) {
  void useStore.getState().refreshReviewSession(tabId);
}

/** Error, first load and empty change set: everything that is not the file list. */
function ReviewPlaceholder({
  tabId,
  session,
  source,
}: {
  tabId: string;
  session: ReviewSession | undefined;
  source: ReviewSource;
}) {
  if (session?.error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <p className="text-sm text-foreground">Could not list the changes.</p>
        <p className="max-w-md text-xs text-foreground-muted">{session.error}</p>
        <button
          type="button"
          onClick={() => refresh(tabId)}
          className="rounded border border-border-dark px-2.5 py-1 text-xs text-foreground hover:bg-hover-bg"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!session || session.loading) {
    return (
      <p role="status" className="px-6 py-10 text-center text-sm text-foreground-muted">
        Reading the changes
      </p>
    );
  }
  return (
    <p data-testid="review-empty" className="px-6 py-10 text-center text-sm text-foreground-muted">
      Nothing to review.{' '}
      {source.kind === 'worktree'
        ? 'The working tree matches HEAD.'
        : `No difference to ${source.ref}.`}
    </p>
  );
}

const REVIEW_SHORTCUTS: ShortcutSheetContent = {
  title: 'Review shortcuts',
  groups: [
    {
      label: 'Move',
      items: [
        { keys: ['↓'], action: 'Next hunk (or J)' },
        { keys: ['↑'], action: 'Previous hunk (or K)' },
        { keys: [']'], action: 'Next file' },
        { keys: ['['], action: 'Previous file' },
      ],
    },
    {
      label: 'Decide',
      items: [
        { keys: ['S'], action: 'Accept the focused hunk, or undo the accept' },
        { keys: ['⌫'], action: 'Discard the focused hunk (asks first)' },
        { keys: ['C'], action: 'Comment on the focused hunk' },
        { keys: ['V'], action: 'Mark the file viewed and go to the next one' },
        { keys: ['O'], action: 'Open or fold the file' },
        { keys: ['⌘', '↵'], action: 'Go to the verdict' },
        { keys: ['?'], action: 'Show these shortcuts' },
      ],
    },
  ],
};

/** One polite live region; repeating the same words still gets announced. */
function useAnnouncer() {
  const [message, setMessage] = useState({ text: '', n: 0 });
  const announce = useCallback(
    (text: string) => setMessage((prev) => ({ text, n: prev.n + 1 })),
    []
  );
  const region = (
    <div role="status" aria-live="polite" className="sr-only" data-testid="review-live">
      {message.text ? <span key={message.n}>{message.text}</span> : null}
    </div>
  );
  return { announce, region };
}

type Nav = ReturnType<typeof useReviewNavigation>;

/** Stands for "no intent known", so the shallow-compared selector stays stable. */
const NO_INTENT = {} as const;

interface ReviewFilesProps {
  tabId: string;
  repoPath: string;
  actionable: boolean;
  entries: readonly ReviewEntry[];
  viewMode: ReviewViewMode;
  sidebarOpen: boolean;
  sidebarId: string;
  progress: ReviewProgress;
  nav: Nav;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function ReviewFiles(props: ReviewFilesProps) {
  const {
    tabId,
    repoPath,
    actionable,
    entries,
    viewMode,
    sidebarOpen,
    sidebarId,
    progress,
    nav,
    scrollRef,
  } = props;
  const current = nav.focus?.path ?? null;
  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen ? (
        <aside id={sidebarId} className="flex w-60 shrink-0 flex-col border-r border-border-dark">
          <p
            data-testid="review-progress"
            className="border-b border-border-dark px-3 py-1.5 text-[11px] text-foreground-muted tabular-nums"
          >
            {progress.viewed} of {progress.total} viewed
          </p>
          <ReviewFileList
            entries={entries}
            currentPath={current}
            onSelect={(path) => nav.moveTo({ path, hunk: null })}
          />
        </aside>
      ) : null}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto">
        {nav.foldedToReview > 0 ? (
          <p
            data-testid="review-folded-note"
            className="border-b border-border-dark px-4 py-1.5 text-[11px] text-foreground-muted"
          >
            {nav.foldedToReview} more {nav.foldedToReview === 1 ? 'file' : 'files'} to review,
            folded to keep this fast. They open as you mark files viewed, or press O on a file.
          </p>
        ) : null}
        {entries.map((entry) => (
          <ReviewFileSection
            key={entry.file.path}
            tabId={tabId}
            repoPath={repoPath}
            file={entry.file}
            viewed={entry.viewed}
            collapsed={nav.isCollapsed(entry)}
            current={entry.file.path === current}
            focusedHunk={entry.file.path === current ? (nav.focus?.hunk ?? null) : null}
            actionable={actionable}
            viewMode={viewMode}
            onToggleCollapsed={nav.toggleCollapsed}
            onToggleViewed={nav.toggleViewed}
            onFocusStop={nav.followFocus}
            onHunkActed={nav.onHunkActed}
            onFileActed={nav.onFileActed}
            onCommentDone={nav.onCommentDone}
            registerKeys={nav.registerKeys}
            registerComposer={nav.registerComposer}
          />
        ))}
      </div>
    </div>
  );
}

/** A review session: every file of one change set, in risk order, with a verdict at the end. */
export function ReviewView({ tabId, onApproveWorkingTree }: ReviewViewProps) {
  const session = useStore((s) => selectReviewSession(s, tabId));
  const parsed = useMemo(() => parseReviewTabId(tabId), [tabId]);
  const source = session?.source ?? parsed;
  const repoPath = source?.repoPath ?? null;
  const files = useStore((s) => selectReviewFiles(s, tabId));
  const marksKey = source ? viewedMarksKey(source) : null;
  const marks = useStore((s) => selectViewedMarks(s, marksKey));
  // Only the fields the header shows: the agent list changes on every activity bump.
  const intentFields = useStore(
    useShallow((s) =>
      repoPath ? (reviewIntentFor(repoPath, s.agents, s.pmTickets) ?? NO_INTENT) : NO_INTENT
    )
  );
  const intent = intentFields === NO_INTENT ? null : (intentFields as ReviewIntent);
  const openComments = useStore(
    (s) => s.reviewComments.filter((c) => c.repoPath === repoPath && isOpenComment(c)).length
  );
  const [viewMode, setViewMode] = useState<ReviewViewMode>('unified');
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarId = useId();
  const { narrow, measureRef } = useNarrow();
  const { announce, region } = useAnnouncer();
  const shortcuts = useShortcutSheet(REVIEW_SHORTCUTS);

  // A restored tab has no session in memory yet: read the change set again, from the same base.
  // Only while the tab is open: a review that was just closed must not come back.
  useEffect(() => {
    if (session || !parsed) return;
    if (!useStore.getState().openTabs.some((t) => t.id === tabId)) return;
    void withMergeBase(parsed, getMergeBase).then((source) =>
      useStore.getState().openReviewSession(source)
    );
  }, [parsed, session, tabId]);

  const entries = useMemo<ReviewEntry[]>(
    () => files.map((file) => ({ file, viewed: viewedState(file, marks) })),
    [files, marks]
  );
  const progress = useMemo(() => reviewProgress(files, marks), [files, marks]);
  const nav = useReviewNavigation(tabId, entries, { scrollRef, primaryRef }, announce);
  const verdict = useReviewVerdict({
    tabId,
    source,
    agentName: intent?.agentName ?? null,
    onApproveWorkingTree,
    announce,
  });
  useReviewAutoRefresh(tabId, repoPath);

  if (!source || !repoPath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        This tab does not name a review.
      </div>
    );
  }

  // Below the narrow width the file list folds away (the toggle brings it back) and two columns
  // become one.
  const sidebarOpen = sidebarPref ?? !narrow;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isShortcutSheetKey(event)) {
      event.preventDefault();
      shortcuts.open();
      return;
    }
    nav.onKeyDown(event);
  };

  return (
    <div
      ref={measureRef}
      data-testid="review-view"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-full flex-col overflow-hidden bg-editor-bg outline-none"
    >
      <ReviewToolbar
        source={source}
        refreshing={!!session?.loading && files.length > 0}
        viewMode={narrow ? 'unified' : viewMode}
        narrow={narrow}
        sidebarOpen={sidebarOpen}
        sidebarId={sidebarId}
        onRefresh={() => refresh(tabId)}
        onToggleViewMode={() => setViewMode((m) => (m === 'unified' ? 'side-by-side' : 'unified'))}
        onToggleSidebar={() => setSidebarPref(!sidebarOpen)}
        onShowShortcuts={shortcuts.open}
      />
      <ReviewIntentHeader intent={intent} />
      {files.length === 0 || session?.error ? (
        <ReviewPlaceholder tabId={tabId} session={session} source={source} />
      ) : (
        <ReviewFiles
          tabId={tabId}
          repoPath={repoPath}
          actionable={source.kind === 'worktree'}
          entries={entries}
          viewMode={narrow ? 'unified' : viewMode}
          sidebarOpen={sidebarOpen}
          sidebarId={sidebarId}
          progress={progress}
          nav={nav}
          scrollRef={scrollRef}
        />
      )}
      <ReviewVerdictBar
        progress={progress}
        openComments={openComments}
        approveKind={approveKindFor(source)}
        busy={verdict.busy}
        primaryRef={primaryRef}
        onRequestChanges={() =>
          sendReviewComments(repoPath, () => announce('Comments sent to the agent'))
        }
        refusal={verdict.refusal}
        onApprove={() => void verdict.approve()}
        onApproveAnyway={() => void verdict.approve({ anyway: true })}
        onClose={verdict.closeReview}
      />
      {region}
      {verdict.confirmDialog}
      {shortcuts.sheet}
    </div>
  );
}
