'use client';

import type { GitBranch, GitNameStatus } from '@/lib/tauri/git';

export interface CompareViewProps {
  branches: GitBranch[];
  compareRef: string | null;
  files: GitNameStatus[];
  loading?: boolean;
  onRefChange?: (ref: string) => void;
  onFileClick?: (path: string) => void;
}

const statusLabel: Record<GitNameStatus['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
};

export function CompareView({
  branches,
  compareRef,
  files,
  loading = false,
  onRefChange,
  onFileClick,
}: CompareViewProps) {
  const local = branches.filter((b) => b.kind === 'local');
  const remote = branches.filter((b) => b.kind === 'remote');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-3 pb-2">
        <select
          data-testid="compare-ref-select"
          value={compareRef ?? ''}
          onChange={(e) => {
            if (e.target.value) onRefChange?.(e.target.value);
          }}
          className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
        >
          <option value="">Select a branch…</option>
          {local.length > 0 && (
            <optgroup label="Local">
              {local.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {remote.length > 0 && (
            <optgroup label="Remote">
              {remote.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto border-t border-border-dark">
        {loading ? (
          <p className="p-3 text-xs text-foreground-muted">Loading…</p>
        ) : (
          files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onFileClick?.(file.path)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-foreground-muted hover:bg-primary/5"
            >
              <span className="flex-1 truncate">{file.path}</span>
              <span className="text-[10px] font-bold">{statusLabel[file.status]}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
