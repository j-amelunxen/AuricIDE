'use client';

import { useState, useEffect, useRef } from 'react';
import type { GitFileStatus } from '@/lib/tauri/git';
import type { ProviderInfo } from '@/lib/tauri/providers';

export interface SourceControlProps {
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  agenticCommit?: boolean;
  ticketPrefix?: string;
  providers?: ProviderInfo[];
  selectedProviderId?: string;
  onCommitMessageChange: (msg: string) => void;
  onCommit: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onFileClick?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onAgenticToggle?: (value: boolean) => void;
  onProviderChange?: (id: string) => void;
  onRefresh?: () => void;
}

const statusBadge: Record<string, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-git-added' },
  modified: { label: 'M', className: 'text-git-modified' },
  deleted: { label: 'D', className: 'text-git-deleted' },
  untracked: { label: 'U', className: 'text-foreground-muted' },
};

function FileList({
  files,
  onFileClick,
  onDiscardFile,
  'data-testid': testId,
}: {
  files: GitFileStatus[];
  onFileClick?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  'data-testid'?: string;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  return (
    <div data-testid={testId}>
      {files.map((file) => {
        const badge = statusBadge[file.status] ?? statusBadge.untracked;
        return (
          <div
            key={file.path}
            role={onFileClick ? 'button' : undefined}
            tabIndex={onFileClick ? 0 : undefined}
            onClick={() => onFileClick?.(file.path)}
            onKeyDown={(e) => {
              if (onFileClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onFileClick(file.path);
              }
            }}
            onContextMenu={(e) => {
              if (!onDiscardFile) return;
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, path: file.path });
            }}
            className={`flex items-center gap-2 px-3 py-1 text-xs text-foreground-muted hover:bg-primary/5 ${onFileClick ? 'cursor-pointer' : ''}`}
          >
            <span className="material-symbols-outlined text-sm">description</span>
            <span className={`flex-1 truncate ${badge.className}`}>{file.path}</span>
            <span className={`text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
          </div>
        );
      })}
      {contextMenu && onDiscardFile && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1000 }}
          className="rounded border border-white/10 bg-panel-bg shadow-lg py-1 min-w-[160px]"
          data-testid="discard-context-menu"
        >
          <button
            onClick={() => {
              onDiscardFile(contextMenu.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">undo</span>
            Discard Changes
          </button>
        </div>
      )}
    </div>
  );
}

export function SourceControlPanel({
  fileStatuses,
  commitMessage,
  isCommitting,
  agenticCommit = false,
  ticketPrefix,
  onCommitMessageChange,
  onCommit,
  onFileClick,
  onDiscardFile,
  onAgenticToggle,
  providers = [],
  selectedProviderId,
  onProviderChange,
  onRefresh,
}: SourceControlProps) {
  return (
    <div data-testid="source-control-panel" className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Source Control
        </h2>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh"
            className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>
        )}
      </div>

      {/* Commit message */}
      <div className="px-3 pb-3">
        {ticketPrefix && (
          <div
            data-testid="ticket-badge"
            className="mb-2 inline-flex items-center gap-1.5 rounded bg-primary/10 border border-primary/20 px-2 py-0.5"
          >
            <span className="material-symbols-outlined text-primary-light text-xs">
              confirmation_number
            </span>
            <span className="text-[11px] font-mono font-bold text-primary-light">
              {ticketPrefix}
            </span>
          </div>
        )}
        <textarea
          placeholder="Commit message"
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          className="w-full resize-none rounded border border-border-dark bg-editor-bg px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
          rows={3}
        />
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={agenticCommit}
              onChange={(e) => onAgenticToggle?.(e.target.checked)}
              className="w-3 h-3 rounded border-white/10 bg-black/40 text-primary focus:ring-primary/50"
            />
            <span className="text-xs text-foreground-muted">Agentic</span>
          </label>

          {agenticCommit && providers.length > 0 && (
            <select
              value={selectedProviderId}
              onChange={(e) => onProviderChange?.(e.target.value)}
              className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground-muted outline-none focus:border-primary"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={onCommit}
          disabled={agenticCommit ? isCommitting : !commitMessage.trim() || isCommitting}
          className="mt-2 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCommitting
            ? agenticCommit
              ? 'Running Agent...'
              : 'Committing...'
            : agenticCommit
              ? 'Agentic Commit'
              : 'Commit & Push'}
        </button>
      </div>

      {/* Changed files */}
      <div className="flex-1 overflow-y-auto border-t border-border-dark">
        {fileStatuses.length === 0 ? (
          <p className="p-3 text-xs text-foreground-muted">No changes</p>
        ) : (
          <>
            <FileList
              data-testid="tracked-files"
              files={fileStatuses.filter((f) => f.status !== 'untracked')}
              onFileClick={onFileClick}
              onDiscardFile={onDiscardFile}
            />
            {fileStatuses.some((f) => f.status === 'untracked') && (
              <div data-testid="untracked-files" className="border-t border-border-dark">
                <h3 className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Untracked
                </h3>
                <FileList
                  files={fileStatuses.filter((f) => f.status === 'untracked')}
                  onFileClick={onFileClick}
                  onDiscardFile={onDiscardFile}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
