'use client';

import type { CommitInfo } from '@/lib/tauri/git';

export interface HistoryViewProps {
  historyPath: string | null;
  commits: CommitInfo[];
  selectedOid?: string | null;
  loading?: boolean;
  onCommitClick?: (oid: string) => void;
}

export function HistoryView({
  historyPath,
  commits,
  selectedOid,
  loading = false,
  onCommitClick,
}: HistoryViewProps) {
  if (!historyPath) {
    return <p className="p-3 text-xs text-foreground-muted">Open a file to see its history.</p>;
  }

  if (loading) {
    return <p className="p-3 text-xs text-foreground-muted">Loading…</p>;
  }

  return (
    <div data-testid="git-history-list" className="flex-1 overflow-y-auto">
      {commits.map((commit) => {
        const selected = commit.oid === selectedOid;
        return (
          <button
            key={commit.oid}
            type="button"
            onClick={() => onCommitClick?.(commit.oid)}
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-primary/5 ${
              selected ? 'bg-primary/10' : ''
            }`}
          >
            <span className="truncate text-xs text-foreground">{commit.summary}</span>
            <span className="truncate text-[10px] text-foreground-muted">
              {commit.author} · {commit.timestamp}
            </span>
          </button>
        );
      })}
    </div>
  );
}
