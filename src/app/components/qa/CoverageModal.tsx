'use client';

import { useState, useMemo } from 'react';
import type { CoverageSummary, FileCoverage } from '@/lib/qa/coverageParser';

type SortKey = 'lines' | 'statements' | 'functions' | 'branches' | 'name';

interface CoverageModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: CoverageSummary;
  files: FileCoverage[];
}

export function CoverageModal({ isOpen, onClose, summary, files }: CoverageModalProps) {
  const [sortKey, setSortKey] = useState<SortKey>('lines');
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');

  const sortedFiles = useMemo(() => {
    const filtered = filter
      ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
      : files;

    return [...filtered].sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') {
        cmp = a.path.localeCompare(b.path);
      } else {
        cmp = a[sortKey] - b[sortKey];
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [files, filter, sortKey, sortAsc]);

  const handleSortClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="coverage-modal-backdrop"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e14] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 bg-white/2 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-xl text-primary">analytics</span>
            <h2 className="text-sm font-bold tracking-wide text-foreground">Coverage Report</h2>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
              {files.length} files
            </span>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-4 gap-px border-b border-white/8 bg-white/5">
          {(
            [
              { label: 'Lines', value: summary.lines },
              { label: 'Statements', value: summary.statements },
              { label: 'Functions', value: summary.functions },
              { label: 'Branches', value: summary.branches },
            ] as const
          ).map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center gap-1 bg-[#0e0e14] py-4">
              <span className={`text-2xl font-black tabular-nums ${getColor(value)}`}>
                {Math.round(value)}%
              </span>
              <span className="text-[9px] font-bold uppercase tracking-widest text-foreground-muted opacity-60">
                {label}
              </span>
              <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full transition-all duration-500 ${getBgColor(value)}`}
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-white/8 bg-white/2 px-5 py-3">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-muted">
              search
            </span>
            <input
              type="text"
              placeholder="Filter files..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-lg border border-white/8 bg-white/4 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder-foreground-muted/50 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-foreground-muted opacity-50">
              Sort:
            </span>
            {(['lines', 'functions', 'branches', 'name'] as SortKey[]).map((key) => (
              <SortButton
                key={key}
                label={key === 'name' ? 'File' : key.charAt(0).toUpperCase() + key.slice(1)}
                sortKey={key}
                active={sortKey === key}
                asc={sortAsc}
                onClick={() => handleSortClick(key)}
              />
            ))}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
          {sortedFiles.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined mb-2 text-2xl text-foreground-muted opacity-30">
                search_off
              </span>
              <p className="text-xs text-foreground-muted">No files match &ldquo;{filter}&rdquo;</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedFiles.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  active,
  asc,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`Sort by ${sortKey}`}
      onClick={onClick}
      className={`flex items-center gap-0.5 rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground-muted hover:bg-white/8 hover:text-foreground'
      }`}
    >
      {label}
      {active && (
        <span className="material-symbols-outlined text-[11px]">
          {asc ? 'arrow_upward' : 'arrow_downward'}
        </span>
      )}
    </button>
  );
}

function FileRow({ file }: { file: FileCoverage }) {
  const metrics: { key: keyof FileCoverage; label: string }[] = [
    { key: 'lines', label: 'Lines' },
    { key: 'statements', label: 'Stmts' },
    { key: 'functions', label: 'Fns' },
    { key: 'branches', label: 'Branches' },
  ];

  const fileName = file.path.split('/').pop() ?? file.path;
  const dir = file.path.split('/').slice(0, -1).join('/');

  return (
    <div className="group rounded-xl border border-white/5 bg-white/2 p-3 transition-all hover:border-white/10 hover:bg-white/4">
      {/* File name + metrics */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span
            data-testid="coverage-file-name"
            className="block truncate text-[12px] font-semibold text-foreground group-hover:text-white"
            title={file.path}
          >
            {fileName}
          </span>
          {dir && (
            <span
              className="block truncate text-[9px] text-foreground-muted opacity-50"
              title={dir}
            >
              {dir}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {metrics.map(({ key, label }) => {
            const val = file[key] as number;
            return (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <span className={`text-[11px] font-bold tabular-nums ${getColor(val)}`}>
                  {Math.round(val)}%
                </span>
                <span className="text-[8px] uppercase tracking-wider text-foreground-muted opacity-40">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Lines progress bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/6">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getBgColor(file.lines)}`}
          style={{ width: `${file.lines}%` }}
        />
      </div>
    </div>
  );
}

function getColor(pct: number) {
  if (pct >= 80) return 'text-emerald-400';
  if (pct >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function getBgColor(pct: number) {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}
