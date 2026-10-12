'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { ReviewSource } from '@/lib/git/review/reviewSession';
import type { ReviewViewMode } from './ReviewFileSection';
import { repoName } from './useReviewVerdict';

function sourceLabel(source: ReviewSource): string {
  if (source.kind === 'worktree') return 'Working tree against HEAD';
  if (source.base?.kind === 'merge-base') return `Changes since it left ${source.ref}`;
  if (source.base?.kind === 'tip') return `Against the tip of ${source.ref}`;
  return `Against ${source.ref}`;
}

/** Said in the header when the merge base was not found, so a reversed change is not a surprise. */
function TipFallbackNote({ source }: { source: ReviewSource }) {
  if (source.kind !== 'ref' || source.base?.kind !== 'tip') return null;
  return (
    <p
      data-testid="review-base-fallback"
      title={source.base.reason}
      className="border-b border-border-dark px-4 py-1.5 text-[11px] text-amber-300"
    >
      Could not find where this branch left {source.ref}, so this compares with the tip of{' '}
      {source.ref}. Changes that landed on {source.ref} since then show up reversed.
    </p>
  );
}

const TOOL_BUTTON =
  'flex min-h-6 items-center gap-1 rounded px-1.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// code-gate: complexity-parameter-count - one destructured props object, named at the call site
export function ReviewToolbar({
  source,
  refreshing,
  viewMode,
  narrow,
  sidebarOpen,
  sidebarId,
  onRefresh,
  onToggleViewMode,
  onToggleSidebar,
  onShowShortcuts,
}: {
  source: ReviewSource;
  refreshing: boolean;
  viewMode: ReviewViewMode;
  /** Side-by-side does not fit; the switch says why it is off. */
  narrow: boolean;
  sidebarOpen: boolean;
  sidebarId: string;
  onRefresh: () => void;
  onToggleViewMode: () => void;
  onToggleSidebar: () => void;
  onShowShortcuts: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-dark px-3 py-1.5">
        <button
          type="button"
          data-testid="review-sidebar-toggle"
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          aria-label={sidebarOpen ? 'Hide the file list' : 'Show the file list'}
          title={sidebarOpen ? 'Hide the file list' : 'Show the file list'}
          onClick={onToggleSidebar}
          className={TOOL_BUTTON}
        >
          <AuricIcon name="format_list_bulleted" className="text-sm" />
        </button>
        <AuricIcon name="fact_check" className="shrink-0 text-sm text-primary-light" />
        <h2 className="shrink-0 text-xs font-medium text-foreground">
          Review {repoName(source.repoPath)}
        </h2>
        <span className="min-w-0 truncate text-[11px] text-foreground-muted">
          {sourceLabel(source)}
        </span>
        {refreshing ? <span className="text-[11px] text-foreground-muted">Refreshing</span> : null}
        <span className="ml-auto" />
        <button
          type="button"
          aria-label="Read the changes again"
          title="Read the changes again"
          onClick={onRefresh}
          className={TOOL_BUTTON}
        >
          <AuricIcon name="refresh" className="text-sm" />
        </button>
        <button
          type="button"
          data-testid="review-view-toggle"
          onClick={onToggleViewMode}
          disabled={narrow}
          title={narrow ? 'Too narrow for side-by-side; widen the editor to switch' : undefined}
          className={TOOL_BUTTON}
        >
          <AuricIcon
            name={viewMode === 'unified' ? 'view_column_2' : 'view_agenda'}
            className="text-sm"
          />
          {viewMode === 'unified' ? 'Side-by-side' : 'Unified'}
        </button>
        <button
          type="button"
          data-testid="review-shortcuts"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
          onClick={onShowShortcuts}
          className={TOOL_BUTTON}
        >
          <AuricIcon name="keyboard" className="text-sm" />
        </button>
      </div>
      <TipFallbackNote source={source} />
    </>
  );
}
