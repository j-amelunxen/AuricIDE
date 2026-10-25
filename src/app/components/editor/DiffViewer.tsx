'use client';

import { useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { parseModeChange } from '@/lib/git/modeChange';
import {
  buildSideBySideRows,
  parseDiff,
  type DiffLine,
  type SideBySideRow,
} from '@/lib/git/parseDiff';
import { fileLevelFlags } from '@/lib/git/review/riskChips';
import { useShortcutSheet, type ShortcutSheetContent } from '../git/shared/ShortcutSheet';
import { isShortcutSheetKey } from '../git/shared/shortcutKeys';
import { DiffNavButtons } from './diff/DiffNavButtons';
import { HunkHeaderContext } from './diff/HunkHeaderContext';
import { LineCommentContext } from './diff/LineCommentContext';
import { LineEditContext } from './diff/LineEditContext';
import { ModeOnlyChange } from './diff/ModeOnlyChange';
import { SideBySideView } from './diff/SideBySideView';
import { UnifiedView } from './diff/UnifiedView';
import { UnlockedEditor } from './diff/UnlockedEditor';
import { RiskChips } from './diff/RiskChips';
import { useDiffViewerState } from './diff/useDiffViewerState';
import { hunkCountOf } from './diff/types';
import { useHunkHeaderApi } from './diff/useHunkHeaderApi';
import { useNarrow } from './diff/useNarrow';
import type { DiffViewerProps } from './diff/types';

export type { DiffLine, SideBySideRow, DiffViewerProps };
export { parseDiff, buildSideBySideRows };

const DIFF_SHORTCUTS: ShortcutSheetContent = {
  title: 'Diff shortcuts',
  groups: [
    {
      label: 'Hunks',
      items: [
        { keys: ['⌥', '↓'], action: 'Next hunk' },
        { keys: ['⌥', '↑'], action: 'Previous hunk' },
        { keys: ['S'], action: 'Stage the focused hunk (unstage in a staged diff)' },
        { keys: ['⌫'], action: 'Discard the focused hunk (asks first)' },
        { keys: ['C'], action: 'Comment on the focused hunk' },
        { keys: ['?'], action: 'Show these shortcuts' },
      ],
    },
  ],
};

export function DiffViewer(props: DiffViewerProps) {
  const { diff, fileName, repoPath, source, emptyMessage = 'No changes' } = props;
  const {
    viewMode,
    setViewMode,
    activeHunk,
    lines,
    riskFlags,
    hunkActions,
    viewerRef,
    canEditFile,
    unlocked,
    toggleLock,
    onUnlockedClosed,
    canComment,
    repoCommentCount,
    sendComments,
    goToHunk,
    onKeyDown,
    lineComment,
    lineEdit,
  } = useDiffViewerState(props);
  const { toolbarActions, busy, confirmDialog } = hunkActions;

  const { narrow, measureRef } = useNarrow();
  const shortcuts = useShortcutSheet(DIFF_SHORTCUTS);
  // Two columns stop being readable below the narrow width; the toggle comes back with the room.
  const effectiveMode = narrow ? 'unified' : viewMode;
  const hunkHeader = useHunkHeaderApi({
    focusedHunk: activeHunk,
    hunkCount: hunkCountOf(lines),
    fileName,
    riskFlags,
    toolbarActions,
    busy,
  });
  const addedLineNumbers = useMemo(
    () =>
      lines.flatMap((line) =>
        line.type === 'added' && line.newLineNo !== null ? [line.newLineNo] : []
      ),
    [lines]
  );
  const fileFlags = useMemo(() => fileLevelFlags(riskFlags), [riskFlags]);

  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        {emptyMessage}
      </div>
    );
  }

  // Content changes win: with hunks present, the patch itself is the story.
  const modeChange = lines.length === 0 ? parseModeChange(diff) : null;
  if (modeChange) {
    return <ModeOnlyChange fileName={fileName} change={modeChange} />;
  }

  return (
    <div
      ref={(node) => {
        viewerRef.current = node;
        measureRef(node);
      }}
      data-testid="diff-viewer"
      tabIndex={0}
      onKeyDown={(event) => {
        if (isShortcutSheetKey(event)) {
          event.preventDefault();
          shortcuts.open();
          return;
        }
        onKeyDown(event);
      }}
      className="flex h-full flex-col overflow-hidden bg-editor-bg"
    >
      <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2">
        <AuricIcon name="difference" className="text-sm text-primary-light" />
        <span className="text-xs font-medium text-foreground">{fileName}</span>
        <RiskChips flags={fileFlags} />
        {canEditFile && (
          <button
            type="button"
            data-testid="diff-lock-toggle"
            aria-pressed={unlocked}
            aria-label={unlocked ? 'Lock the diff' : 'Unlock to edit the file'}
            title={
              unlocked
                ? 'Lock again and return to the diff'
                : 'Unlock: edit the whole file freely, with syntax highlighting'
            }
            onClick={toggleLock}
            className={`flex min-h-6 items-center rounded px-1.5 text-sm hover:bg-hover-bg motion-safe:active:scale-[0.96] ${
              unlocked ? 'text-primary' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            <AuricIcon name={unlocked ? 'lock_open' : 'lock'} />
          </button>
        )}
        {canEditFile && (
          <span className="text-[10px] text-foreground-muted">
            {unlocked
              ? 'Unlocked: edit freely, right-click for rename and find & replace'
              : 'Double-click a line to edit'}
          </span>
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
              className="mr-1 flex items-center gap-1 rounded px-2 py-0.5 text-xs text-primary hover:bg-primary/10 motion-safe:active:scale-[0.96]"
              title="Send review comments to an agent"
            >
              <AuricIcon name="bolt" className="text-sm" />
              Send {repoCommentCount} {repoCommentCount === 1 ? 'comment' : 'comments'}
            </button>
          )}
          <DiffNavButtons
            viewMode={effectiveMode}
            narrow={narrow}
            onPrev={() => goToHunk(activeHunk - 1)}
            onNext={() => goToHunk(activeHunk + 1)}
            onToggleView={() => setViewMode((m) => (m === 'unified' ? 'side-by-side' : 'unified'))}
          />
        </div>
      </div>
      <LineCommentContext.Provider value={lineComment}>
        <LineEditContext.Provider value={lineEdit}>
          <HunkHeaderContext.Provider value={hunkHeader}>
            {unlocked && repoPath ? (
              <UnlockedEditor
                repoPath={repoPath}
                filePath={fileName}
                addedLineNumbers={addedLineNumbers}
                restage={source?.kind === 'staged'}
                onClosed={onUnlockedClosed}
              />
            ) : effectiveMode === 'unified' ? (
              <UnifiedView lines={lines} />
            ) : (
              <SideBySideView lines={lines} />
            )}
          </HunkHeaderContext.Provider>
        </LineEditContext.Provider>
      </LineCommentContext.Provider>
      {confirmDialog}
      {shortcuts.sheet}
    </div>
  );
}
