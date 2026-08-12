'use client';

import { useState } from 'react';
import { ContextMenu } from '../ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import type { GitFileStatus } from '@/lib/tauri/git';
import type { ProviderInfo } from '@/lib/tauri/providers';

export interface SourceControlProps {
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  isPushing?: boolean;
  /** Pushes the current branch to origin. Omit to hide the button. */
  onPush?: () => void;
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

  // Asked in-app and awaited. The browser's confirm() does not suspend the
  // script inside the Tauri webview, so the file would already be gone by the
  // time the user reads the question.
  const { confirm, confirmDialog } = useConfirm();

  /**
   * Discard is the only action here git cannot take back, and its menu item
   * appears directly under the cursor after a right-click. What it costs
   * depends on whether git has a copy: for a file that was never committed
   * there is nothing behind it, so discarding is a plain deletion — say that
   * instead of the softer "changes are lost".
   */
  const confirmDiscard = async (file: GitFileStatus) => {
    const neverCommitted = file.status === 'untracked' || file.status === 'added';
    const go = await confirm(
      neverCommitted
        ? {
            title: 'Delete this file?',
            message: `${file.path} has never been committed, so git has no copy of it. Discarding deletes it from disk and it cannot be recovered.`,
            confirmLabel: 'Delete',
          }
        : {
            title: 'Discard changes?',
            message: `Discard your changes to ${file.path}? It is restored to the last commit and the uncommitted changes are gone for good.`,
            confirmLabel: 'Discard',
          }
    );
    if (!go) return;
    onDiscardFile?.(file.path);
  };

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
            <AuricIcon name="description" className="text-sm" />
            <span className={`flex-1 truncate ${badge.className}`}>{file.path}</span>
            <span className={`text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
          </div>
        );
      })}
      {contextMenu && onDiscardFile && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={[
            {
              label: 'Discard Changes',
              icon: 'undo',
              danger: true,
              action: () => {
                const file = files.find((f) => f.path === contextMenu.path);
                if (file) void confirmDiscard(file);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export function SourceControlPanel({
  fileStatuses,
  commitMessage,
  isCommitting,
  isPushing = false,
  onPush,
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
            <AuricIcon name="refresh" className="text-sm" />
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
            <AuricIcon name="confirmation_number" className="text-primary-light text-xs" />
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
              className="h-3.5 w-3.5 accent-primary"
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
        {/* Commit and push are two separate actions, classic-git style: a
            commit is local and cheap, a push publishes. One button per
            promise, each label saying exactly what it does. */}
        <div className="mt-2 flex gap-2">
          <button
            onClick={onCommit}
            disabled={agenticCommit ? isCommitting : !commitMessage.trim() || isCommitting}
            className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCommitting
              ? agenticCommit
                ? 'Running Agent...'
                : 'Committing...'
              : agenticCommit
                ? 'Agentic Commit'
                : 'Commit'}
          </button>
          {onPush && (
            <button
              onClick={onPush}
              disabled={isPushing}
              title="Push the current branch to origin"
              className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light transition-colors hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPushing ? 'Pushing...' : 'Push'}
            </button>
          )}
        </div>
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
