'use client';

import type { StoreDiagnostic } from '@/lib/store/diagnosticsSlice';

export interface ProblemsPanelProps {
  diagnostics: StoreDiagnostic[];
  filePath: string;
  onClose: () => void;
  onNavigate: (line: number) => void;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function ProblemsPanel({ diagnostics, filePath, onClose, onNavigate }: ProblemsPanelProps) {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <div className="flex h-full flex-col bg-panel-bg border-t border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Problems
          </h2>
          {filePath && (
            <span className="text-xs text-foreground-muted">{getFileName(filePath)}</span>
          )}
          <span className="text-xs text-foreground-muted">&mdash;</span>
          {errors > 0 && (
            <span
              data-testid="error-count"
              className="flex items-center gap-1 text-xs text-red-400"
            >
              <span className="text-[10px]">●</span> {errors}
            </span>
          )}
          {warnings > 0 && (
            <span
              data-testid="warning-count"
              className="flex items-center gap-1 text-xs text-amber-400"
            >
              <span className="text-[10px]">⚠</span> {warnings}
            </span>
          )}
          {errors === 0 && warnings === 0 && (
            <span className="text-xs text-foreground-muted">0</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
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
        {diagnostics.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-xs text-foreground-muted">No problems detected</p>
          </div>
        ) : (
          diagnostics.map((diag, idx) => (
            <button
              key={`${diag.line}-${diag.column}-${idx}`}
              onClick={() => onNavigate(diag.line)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-white/5"
            >
              <span
                className={`shrink-0 text-[10px] ${
                  diag.severity === 'error' ? 'text-red-400' : 'text-amber-400'
                }`}
              >
                {diag.severity === 'error' ? '●' : '⚠'}
              </span>
              <span className="shrink-0 text-foreground-muted/50 tabular-nums">Ln {diag.line}</span>
              <span className="truncate text-foreground-muted">{diag.message}</span>
              <span className="ml-auto shrink-0 text-[10px] text-foreground-muted/30">
                {diag.ruleId.replace('remark-lint:', '')}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
