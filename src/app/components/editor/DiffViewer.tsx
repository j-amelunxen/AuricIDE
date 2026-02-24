'use client';

import { useState } from 'react';

export interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
  isHeader?: boolean;
}

export function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', content: line.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (line.length > 0) {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLineNo: oldLine,
        newLineNo: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

export function buildSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'header') {
      rows.push({ left: line, right: line, isHeader: true });
      i++;
      continue;
    }

    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }

    // Collect consecutive removed/added block
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];

    while (i < lines.length && lines[i].type === 'removed') {
      removed.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === 'added') {
      added.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(removed.length, added.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        left: j < removed.length ? removed[j] : null,
        right: j < added.length ? added[j] : null,
      });
    }
  }

  return rows;
}

const lineStyles: Record<DiffLine['type'], string> = {
  added: 'bg-green-900/30 text-green-300',
  removed: 'bg-red-900/30 text-red-300',
  context: 'text-foreground-muted',
  header: 'bg-blue-900/20 text-blue-300 font-bold',
};

export interface DiffViewerProps {
  diff: string;
  fileName: string;
}

export function DiffViewer({ diff, fileName }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const lines = parseDiff(diff);

  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        No changes
      </div>
    );
  }

  return (
    <div data-testid="diff-viewer" className="flex h-full flex-col overflow-hidden bg-editor-bg">
      <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2">
        <span className="material-symbols-outlined text-sm text-primary-light">difference</span>
        <span className="text-xs font-medium text-foreground">{fileName}</span>
        <button
          data-testid="diff-view-toggle"
          onClick={() => setViewMode((m) => (m === 'unified' ? 'side-by-side' : 'unified'))}
          className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
          title={viewMode === 'unified' ? 'Switch to side-by-side' : 'Switch to unified'}
        >
          <span className="material-symbols-outlined text-sm">
            {viewMode === 'unified' ? 'view_column_2' : 'view_agenda'}
          </span>
          {viewMode === 'unified' ? 'Side-by-side' : 'Unified'}
        </button>
      </div>
      {viewMode === 'unified' ? <UnifiedView lines={lines} /> : <SideBySideView lines={lines} />}
    </div>
  );
}

function UnifiedView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="flex-1 overflow-auto font-mono text-xs leading-5">
      {lines.map((line, i) => (
        <div key={i} className={`flex ${lineStyles[line.type]}`}>
          <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
            {line.oldLineNo ?? ''}
          </span>
          <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
            {line.newLineNo ?? ''}
          </span>
          <span className="w-6 shrink-0 select-none text-center">
            {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
          </span>
          <span className="flex-1 whitespace-pre pr-4">{line.content}</span>
        </div>
      ))}
    </div>
  );
}

function SideBySideView({ lines }: { lines: DiffLine[] }) {
  const rows = buildSideBySideRows(lines);

  return (
    <div
      data-testid="diff-side-by-side"
      className="flex-1 overflow-auto font-mono text-xs leading-5"
    >
      {rows.map((row, i) => {
        if (row.isHeader) {
          return (
            <div key={i} className={`flex ${lineStyles.header}`}>
              <span className="flex-1 whitespace-pre px-4">{row.left!.content}</span>
            </div>
          );
        }

        return (
          <div key={i} className="flex">
            {/* Left (old) */}
            <div
              className={`flex w-1/2 border-r border-border-dark ${
                row.left ? lineStyles[row.left.type] : ''
              }`}
            >
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {row.left?.oldLineNo ?? row.left?.newLineNo ?? ''}
              </span>
              <span className="flex-1 whitespace-pre pr-4">{row.left?.content ?? ''}</span>
            </div>
            {/* Right (new) */}
            <div className={`flex w-1/2 ${row.right ? lineStyles[row.right.type] : ''}`}>
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {row.right?.newLineNo ?? row.right?.oldLineNo ?? ''}
              </span>
              <span className="flex-1 whitespace-pre pr-4">{row.right?.content ?? ''}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
