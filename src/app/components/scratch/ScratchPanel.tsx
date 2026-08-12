'use client';

import { useEffect, useRef, useState } from 'react';
import { type ScratchFile } from '@/lib/store/scratchSlice';
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface ScratchPanelProps {
  scratches: ScratchFile[];
  activeTabId: string | null;
  onCreate: () => void;
  onOpen: (path: string) => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string) => void;
  onDeleteAll: () => void;
  onRefresh: () => void;
}

/**
 * Global scratch files: quick throwaway Markdown buffers living outside any
 * project. No file watcher covers the scratch dir, so the list refreshes on
 * every mount instead of updating itself.
 */
export function ScratchPanel({
  scratches,
  activeTabId,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onDeleteAll,
  onRefresh,
}: ScratchPanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<ScratchFile | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const submitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (value) onRename(renaming.path, value);
    setRenaming(null);
  };

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Scratches
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onCreate}
            aria-label="New scratch file"
            title="New scratch file"
            className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5"
          >
            <AuricIcon name="note_add" className="text-[16px]" />
          </button>
          <button
            onClick={() => setConfirmAll(true)}
            disabled={scratches.length === 0}
            aria-label="Delete all scratch files"
            title="Delete all scratch files"
            className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AuricIcon name="delete_sweep" className="text-[16px]" />
          </button>
        </div>
      </div>

      {scratches.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AuricIcon name="sticky_note_2" className="text-[28px] text-foreground-muted/60" />
          <p className="text-xs text-foreground-muted">
            Throwaway Markdown notes, global across projects.
          </p>
          <button
            onClick={onCreate}
            className="px-3 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            New Scratch File
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {scratches.map((scratch) => {
            const isActive = activeTabId === scratch.path;
            const isRenaming = renaming?.path === scratch.path;
            return (
              <div
                key={scratch.path}
                data-active={isActive}
                className={`group flex items-center gap-2 px-3 py-1 cursor-pointer text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                }`}
                onClick={() => {
                  if (!isRenaming) onOpen(scratch.path);
                }}
              >
                <AuricIcon name="sticky_note_2" className="text-[15px] shrink-0" />
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renaming.value}
                    onChange={(e) => setRenaming({ path: scratch.path, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-background border border-border-dark rounded px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <span className="flex-1 truncate">{scratch.name}</span>
                )}
                {!isRenaming && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming({
                          path: scratch.path,
                          value: scratch.name.replace(/\.md$/, ''),
                        });
                      }}
                      aria-label={`Rename ${scratch.name}`}
                      title="Rename"
                      className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5"
                    >
                      <AuricIcon name="edit" className="text-[13px]" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(scratch);
                      }}
                      aria-label={`Delete ${scratch.name}`}
                      title="Delete"
                      className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5"
                    >
                      <AuricIcon name="delete" className="text-[13px]" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete scratch?"
          message={`This removes "${deleteTarget.name}" permanently.`}
          confirmLabel="Delete"
          onConfirm={() => {
            onDelete(deleteTarget.path);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {confirmAll && (
        <ConfirmDialog
          title="Delete all scratches?"
          message={`This removes ${scratches.length} scratch file${
            scratches.length === 1 ? '' : 's'
          } permanently.`}
          confirmLabel="Delete All"
          onConfirm={() => {
            onDeleteAll();
            setConfirmAll(false);
          }}
          onCancel={() => setConfirmAll(false)}
        />
      )}
    </div>
  );
}
