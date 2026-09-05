'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  buildSideBySideRows,
  parseDiff,
  type DiffLine,
  type SideBySideRow,
} from '@/lib/git/parseDiff';
import { LineCommentContext } from './diff/LineCommentContext';
import { LineEditContext } from './diff/LineEditContext';
import { SideBySideView } from './diff/SideBySideView';
import { UnifiedView } from './diff/UnifiedView';
import { useDiffViewerState } from './diff/useDiffViewerState';
import type { DiffViewerProps } from './diff/types';

export type { DiffLine, SideBySideRow, DiffViewerProps };
export { parseDiff, buildSideBySideRows };

export function DiffViewer(props: DiffViewerProps) {
  const { diff, fileName } = props;
  const {
    viewMode,
    setViewMode,
    activeHunk,
    lines,
    viewerRef,
    canEditFile,
    canComment,
    repoCommentCount,
    sendComments,
    goToHunk,
    onKeyDown,
    lineComment,
    lineEdit,
  } = useDiffViewerState(props);

  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        No changes
      </div>
    );
  }

  return (
    <div
      ref={viewerRef}
      data-testid="diff-viewer"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-full flex-col overflow-hidden bg-editor-bg"
    >
      <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2">
        <AuricIcon name="difference" className="text-sm text-primary-light" />
        <span className="text-xs font-medium text-foreground">{fileName}</span>
        {canEditFile && (
          <span className="text-[10px] text-foreground-muted">Double-click a line to edit</span>
        )}
        {canComment && (
          <span className="text-[10px] text-foreground-muted">Comment a line for the agent</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {repoCommentCount > 0 && (
            <button
              type="button"
              data-testid="diff-send-comments"
              onClick={sendComments}
              className="mr-1 flex items-center gap-1 rounded px-2 py-0.5 text-xs text-primary hover:bg-primary/10 active:scale-[0.96]"
              title="Send review comments to an agent"
            >
              <AuricIcon name="bolt" className="text-sm" />
              Send {repoCommentCount} {repoCommentCount === 1 ? 'comment' : 'comments'}
            </button>
          )}
          <button
            data-testid="diff-prev-hunk"
            onClick={() => goToHunk(activeHunk - 1)}
            className="flex items-center rounded px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title="Previous hunk"
          >
            <AuricIcon name="arrow_upward" className="text-sm" />
          </button>
          <button
            data-testid="diff-next-hunk"
            onClick={() => goToHunk(activeHunk + 1)}
            className="flex items-center rounded px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title="Next hunk"
          >
            <AuricIcon name="arrow_downward" className="text-sm" />
          </button>
          <button
            data-testid="diff-view-toggle"
            onClick={() => setViewMode((m) => (m === 'unified' ? 'side-by-side' : 'unified'))}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title={viewMode === 'unified' ? 'Switch to side-by-side' : 'Switch to unified'}
          >
            <AuricIcon
              name={viewMode === 'unified' ? 'view_column_2' : 'view_agenda'}
              className="text-sm"
            />
            {viewMode === 'unified' ? 'Side-by-side' : 'Unified'}
          </button>
        </div>
      </div>
      <LineCommentContext.Provider value={lineComment}>
        <LineEditContext.Provider value={lineEdit}>
          {viewMode === 'unified' ? (
            <UnifiedView lines={lines} />
          ) : (
            <SideBySideView lines={lines} />
          )}
        </LineEditContext.Provider>
      </LineCommentContext.Provider>
    </div>
  );
}
