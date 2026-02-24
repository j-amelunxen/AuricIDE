'use client';

import { useMemo } from 'react';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';

export interface ReferencesPanelProps {
  results: ReferenceResult[];
  query: string;
  onClose: () => void;
  onNavigate: (filePath: string, line: number) => void;
}

function groupByFile(results: ReferenceResult[]): Map<string, ReferenceResult[]> {
  const grouped = new Map<string, ReferenceResult[]>();
  for (const result of results) {
    const existing = grouped.get(result.filePath) ?? [];
    existing.push(result);
    grouped.set(result.filePath, existing);
  }
  return grouped;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function ReferencesPanel({ results, query, onClose, onNavigate }: ReferencesPanelProps) {
  const grouped = useMemo(() => groupByFile(results), [results]);

  return (
    <div className="flex h-full flex-col bg-panel-bg border-t border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            References
          </h2>
          <span className="text-xs text-foreground-muted">
            &ldquo;{query}&rdquo; &mdash;{' '}
            {results.length === 0 ? 'No references found' : `${results.length} references`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-foreground-muted transition-colors hover:bg-white/5
            hover:text-foreground"
          aria-label="Close"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M3 3L11 11M11 3L3 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-xs text-foreground-muted">No references found</p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([filePath, fileResults]) => (
            <div key={filePath} className="border-b border-white/5 last:border-b-0">
              {/* File group header */}
              <div className="sticky top-0 bg-panel-bg px-3 py-1.5">
                <span className="text-xs font-medium text-foreground-muted">
                  {getFileName(filePath)}
                </span>
                <span className="ml-2 text-[10px] text-foreground-muted/50">{filePath}</span>
              </div>
              {/* Individual references */}
              {fileResults.map((result, idx) => (
                <button
                  key={`${result.lineNumber}-${idx}`}
                  onClick={() => onNavigate(result.filePath, result.lineNumber)}
                  className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs
                    transition-colors hover:bg-white/5"
                >
                  <span className="shrink-0 text-foreground-muted/50 tabular-nums">
                    :{result.lineNumber}
                  </span>
                  <span className="truncate text-foreground-muted">{result.lineText}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
