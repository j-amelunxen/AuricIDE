'use client';

import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { BlueprintCard } from './BlueprintCard';
import { BlueprintCreateModal } from './BlueprintCreateModal';
import type { Blueprint } from '@/lib/tauri/blueprints';
import { CATEGORY_LABELS } from '@/lib/blueprints/constants';

export function BlueprintsPanel() {
  const {
    blueprintsDraft,
    blueprintsDirty,
    blueprintsModalOpen,
    selectedBlueprintId,
    blueprintServerUrl,
    blueprintSyncStatus,
    blueprintSyncError,
    rootPath,
    loadBlueprints,
    saveBlueprints,
    addBlueprint,
    deleteBlueprint,
    discardBlueprintChanges,
    setBlueprintsModalOpen,
    setSelectedBlueprintId,
  } = useStore();

  useEffect(() => {
    if (rootPath) {
      loadBlueprints(rootPath);
    }
  }, [rootPath, loadBlueprints]);

  const grouped = useMemo(
    () =>
      blueprintsDraft.reduce<Record<string, Blueprint[]>>((acc, bp) => {
        const cat = bp.category || 'architectures';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(bp);
        return acc;
      }, {}),
    [blueprintsDraft]
  );

  const handleCreate = async (data: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    addBlueprint({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...data,
    });
    if (rootPath) await saveBlueprints(rootPath);
    setBlueprintsModalOpen(false);
  };

  const categories = Object.keys(CATEGORY_LABELS);

  return (
    <>
      <div className="flex h-full flex-col bg-panel-bg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
              Blueprints
            </h2>
            {blueprintServerUrl && blueprintSyncStatus !== 'idle' && (
              <span
                title={
                  blueprintSyncStatus === 'error'
                    ? (blueprintSyncError ?? 'Sync error')
                    : blueprintSyncStatus === 'syncing'
                      ? 'Syncing…'
                      : blueprintSyncStatus === 'success'
                        ? 'Synced'
                        : 'Server unreachable'
                }
                className={
                  blueprintSyncStatus === 'syncing'
                    ? 'text-amber-400'
                    : blueprintSyncStatus === 'success'
                      ? 'text-emerald-400'
                      : blueprintSyncStatus === 'error'
                        ? 'text-rose-400'
                        : 'text-foreground-muted'
                }
              >
                <span
                  className={`material-symbols-outlined text-[12px] ${blueprintSyncStatus === 'syncing' ? 'animate-spin' : ''}`}
                >
                  {blueprintSyncStatus === 'syncing'
                    ? 'sync'
                    : blueprintSyncStatus === 'success'
                      ? 'check_circle'
                      : blueprintSyncStatus === 'error'
                        ? 'error'
                        : 'wifi_off'}
                </span>
              </span>
            )}
          </div>
          <button
            onClick={() => setBlueprintsModalOpen(true)}
            className="rounded p-0.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
            title="New blueprint"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {blueprintsDraft.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="material-symbols-outlined mb-3 text-3xl text-foreground-muted opacity-40">
                library_books
              </span>
              <p className="text-xs text-foreground-muted">No blueprints yet</p>
              <button
                onClick={() => setBlueprintsModalOpen(true)}
                className="mt-3 rounded-lg bg-primary/15 px-4 py-2 text-xs font-bold text-primary transition-all hover:bg-primary/25"
              >
                Create Blueprint
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {categories
                .filter((cat) => grouped[cat]?.length)
                .map((cat) => (
                  <div key={cat}>
                    <h3 className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-muted opacity-60">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {grouped[cat].map((bp) => (
                        <BlueprintCard
                          key={bp.id}
                          blueprint={bp}
                          selected={bp.id === selectedBlueprintId}
                          onSelect={setSelectedBlueprintId}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer actions (save/discard/delete) */}
        {(blueprintsDirty || selectedBlueprintId) && (
          <div className="flex items-center gap-2 border-t border-white/5 p-3">
            {selectedBlueprintId && (
              <button
                onClick={async () => {
                  deleteBlueprint(selectedBlueprintId);
                  setSelectedBlueprintId(null);
                  if (rootPath) await saveBlueprints(rootPath);
                }}
                className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                Delete
              </button>
            )}
            <div className="flex-1" />
            {blueprintsDirty && (
              <>
                <button
                  onClick={discardBlueprintChanges}
                  className="rounded-lg px-3 py-1.5 text-[10px] font-medium text-foreground-muted hover:bg-white/5 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={() => rootPath && saveBlueprints(rootPath)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-[10px] font-bold text-white hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
                >
                  Save
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <BlueprintCreateModal
        isOpen={blueprintsModalOpen}
        onSave={handleCreate}
        onClose={() => setBlueprintsModalOpen(false)}
      />
    </>
  );
}
