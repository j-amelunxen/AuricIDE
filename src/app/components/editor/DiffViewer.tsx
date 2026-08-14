'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useStore } from '@/lib/store';
import {
  buildSideBySideRows,
  parseDiff,
  type DiffLine,
  type SideBySideRow,
} from '@/lib/git/parseDiff';
import { wordDiff, type WordSpan } from '@/lib/git/wordDiff';

export type { DiffLine, SideBySideRow };
export { parseDiff, buildSideBySideRows };

const lineStyles: Record<DiffLine['type'], string> = {
  added: 'bg-green-900/30 text-green-300',
  removed: 'bg-red-900/30 text-red-300',
  context: 'text-foreground-muted',
  header: 'bg-blue-900/20 text-blue-300 font-bold',
};

const TEXT_WRAP = 'min-w-0 flex-1 whitespace-pre-wrap break-all pr-4';
const COLUMN = 'flex w-1/2 min-w-0 overflow-hidden';

export interface DiffViewerProps {
  diff: string;
  fileName: string;
}

function isHunkHeader(line: DiffLine | null | undefined): boolean {
  return !!line && line.type === 'header' && line.content.startsWith('@@');
}

function hunkCountOf(lines: DiffLine[]): number {
  return lines.filter(isHunkHeader).length;
}

function LineContent({
  content,
  spans,
  changedClass,
}: {
  content: string;
  spans?: WordSpan[] | null;
  changedClass?: string;
}) {
  return (
    <span className={TEXT_WRAP}>
      {spans
        ? spans.map((span, i) =>
            span.changed ? (
              <span key={i} className={changedClass}>
                {span.text}
              </span>
            ) : (
              <span key={i}>{span.text}</span>
            )
          )
        : content}
    </span>
  );
}

export function DiffViewer({ diff, fileName }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const [activeHunk, setActiveHunk] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const lines = parseDiff(diff);
  const hunkCount = hunkCountOf(lines);

  const goToHunk = useCallback(
    (index: number) => {
      if (hunkCount === 0) return;
      const next = ((index % hunkCount) + hunkCount) % hunkCount;
      setActiveHunk(next);
      viewerRef.current
        ?.querySelector(`[data-hunk-index="${next}"]`)
        ?.scrollIntoView({ block: 'start' });
    },
    [hunkCount]
  );

  const goToHunkRef = useRef(goToHunk);
  const activeHunkRef = useRef(activeHunk);

  useEffect(() => {
    goToHunkRef.current = goToHunk;
    activeHunkRef.current = activeHunk;
  });

  useEffect(() => {
    let lastNonce = useStore.getState().hunkNavNonce;
    return useStore.subscribe((s) => {
      if (s.hunkNavNonce === lastNonce || !s.hunkNavDirection) return;
      lastNonce = s.hunkNavNonce;
      const current = activeHunkRef.current;
      goToHunkRef.current(s.hunkNavDirection === 'next' ? current + 1 : current - 1);
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      goToHunk(activeHunk + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      goToHunk(activeHunk - 1);
    }
  };

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
        <div className="ml-auto flex items-center gap-1">
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
      {viewMode === 'unified' ? <UnifiedView lines={lines} /> : <SideBySideView lines={lines} />}
    </div>
  );
}

function UnifiedView({ lines }: { lines: DiffLine[] }) {
  let hunkIndex = 0;

  return (
    <div className="flex-1 overflow-auto font-mono text-xs leading-5">
      {lines.map((line, i) => {
        const hunkAttr = isHunkHeader(line) ? hunkIndex++ : undefined;
        return (
          <div key={i} data-hunk-index={hunkAttr} className={`flex ${lineStyles[line.type]}`}>
            <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
              {line.oldLineNo ?? ''}
            </span>
            <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
              {line.newLineNo ?? ''}
            </span>
            <span className="w-6 shrink-0 select-none text-center">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
            </span>
            <LineContent content={line.content} />
          </div>
        );
      })}
    </div>
  );
}

function SideBySideView({ lines }: { lines: DiffLine[] }) {
  const rows = buildSideBySideRows(lines);
  let hunkIndex = 0;

  return (
    <div
      data-testid="diff-side-by-side"
      className="flex-1 overflow-auto font-mono text-xs leading-5"
    >
      {rows.map((row, i) => {
        if (row.isHeader) {
          const hunkAttr = isHunkHeader(row.left) ? hunkIndex++ : undefined;
          return (
            <div key={i} data-hunk-index={hunkAttr} className={`flex ${lineStyles.header}`}>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-4">
                {row.left!.content}
              </span>
            </div>
          );
        }

        const paired =
          row.left?.type === 'removed' && row.right?.type === 'added'
            ? wordDiff(row.left.content, row.right.content)
            : null;

        return (
          <div key={i} className="flex">
            <div
              className={`${COLUMN} border-r border-border-dark ${
                row.left ? lineStyles[row.left.type] : ''
              }`}
            >
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {row.left?.oldLineNo ?? row.left?.newLineNo ?? ''}
              </span>
              <LineContent
                content={row.left?.content ?? ''}
                spans={paired?.left}
                changedClass="rounded-sm bg-red-500/35"
              />
            </div>
            <div className={`${COLUMN} ${row.right ? lineStyles[row.right.type] : ''}`}>
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {row.right?.newLineNo ?? row.right?.oldLineNo ?? ''}
              </span>
              <LineContent
                content={row.right?.content ?? ''}
                spans={paired?.right}
                changedClass="rounded-sm bg-green-500/35"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
