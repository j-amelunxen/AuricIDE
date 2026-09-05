'use client';

import { useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { BlueprintCreateModal } from './BlueprintCreateModal';
import type { Blueprint } from '@/lib/tauri/blueprints';
import { persistInBackground, persistQuietly } from '@/lib/store/persistFeedback';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { BlueprintReadingOverlay } from './gallery/BlueprintReadingOverlay';
import { BlueprintDetailPane } from './gallery/BlueprintDetailPane';
import { BlueprintListColumn } from './gallery/BlueprintListColumn';

export { BlueprintReadingOverlay } from './gallery/BlueprintReadingOverlay';
export { BlueprintDetailPane } from './gallery/BlueprintDetailPane';
export { BlueprintListColumn } from './gallery/BlueprintListColumn';

export function BlueprintsGallery() {
  const blueprintsGalleryOpen = useStore((s) => s.blueprintsGalleryOpen);
  if (!blueprintsGalleryOpen) return null;
  return <BlueprintsGalleryContent />;
}

function BlueprintsGalleryContent() {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const blueprintsGalleryOpen = useStore((s) => s.blueprintsGalleryOpen);
  const setBlueprintsGalleryOpen = useStore((s) => s.setBlueprintsGalleryOpen);
  const blueprintsDraft = useStore((s) => s.blueprintsDraft);
  const blueprintsDirty = useStore((s) => s.blueprintsDirty);
  const blueprintsModalOpen = useStore((s) => s.blueprintsModalOpen);
  const selectedBlueprintId = useStore((s) => s.selectedBlueprintId);
  const blueprintServerUrl = useStore((s) => s.blueprintServerUrl);
  const blueprintSyncStatus = useStore((s) => s.blueprintSyncStatus);
  const blueprintSyncError = useStore((s) => s.blueprintSyncError);
  const rootPath = useStore((s) => s.rootPath);
  const addBlueprint = useStore((s) => s.addBlueprint);
  const updateBlueprint = useStore((s) => s.updateBlueprint);
  const deleteBlueprint = useStore((s) => s.deleteBlueprint);
  const discardBlueprintChanges = useStore((s) => s.discardBlueprintChanges);
  const saveBlueprints = useStore((s) => s.saveBlueprints);
  const setBlueprintsModalOpen = useStore((s) => s.setBlueprintsModalOpen);
  const setSelectedBlueprintId = useStore((s) => s.setSelectedBlueprintId);

  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [complexityFilter, setComplexityFilter] = useState<string>('all');
  const [editTarget, setEditTarget] = useState<Blueprint | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);

  useOverlayLayer({
    id: 'blueprints-gallery',
    kind: 'tool',
    active: blueprintsGalleryOpen,
    onEscape: () => {
      if (readingOpen) setReadingOpen(false);
      else setBlueprintsGalleryOpen(false);
    },
  });

  const filtered = blueprintsDraft
    .filter(
      (bp) =>
        search === '' ||
        [bp.name, bp.goal, bp.techStack, bp.description, bp.spec].some((f) =>
          f.toLowerCase().includes(search.toLowerCase())
        )
    )
    .filter((bp) => categoryFilter === 'all' || bp.category === categoryFilter)
    .filter((bp) => complexityFilter === 'all' || bp.complexity === complexityFilter);

  const selectedBlueprint = blueprintsDraft.find((bp) => bp.id === selectedBlueprintId) ?? null;

  const handleSave = useCallback(
    async (data: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (editTarget) {
        updateBlueprint(editTarget.id, { ...data, updatedAt: new Date().toISOString() });
      } else {
        const now = new Date().toISOString();
        addBlueprint({ id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...data });
      }
      if (rootPath) await persistQuietly(saveBlueprints(rootPath));
      setBlueprintsModalOpen(false);
      setEditTarget(null);
    },
    [editTarget, addBlueprint, updateBlueprint, saveBlueprints, rootPath, setBlueprintsModalOpen]
  );

  const handleEdit = useCallback(
    (bp: Blueprint) => {
      setEditTarget(bp);
      setBlueprintsModalOpen(true);
    },
    [setBlueprintsModalOpen]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const name = blueprintsDraft.find((bp) => bp.id === id)?.name ?? 'this blueprint';
      const go = await confirm({
        title: 'Delete this blueprint?',
        message: `This permanently deletes "${name}".`,
        confirmLabel: 'Delete',
      });
      if (!go) return;
      deleteBlueprint(id);
      if (selectedBlueprintId === id) setSelectedBlueprintId(null);
      if (rootPath) await persistQuietly(saveBlueprints(rootPath));
    },
    [
      confirm,
      blueprintsDraft,
      deleteBlueprint,
      selectedBlueprintId,
      setSelectedBlueprintId,
      saveBlueprints,
      rootPath,
    ]
  );

  const syncIcon =
    blueprintSyncStatus === 'syncing'
      ? 'sync'
      : blueprintSyncStatus === 'success'
        ? 'check_circle'
        : blueprintSyncStatus === 'error'
          ? 'error'
          : blueprintSyncStatus === 'unreachable'
            ? 'wifi_off'
            : null;

  const syncColor =
    blueprintSyncStatus === 'syncing'
      ? 'text-amber-400'
      : blueprintSyncStatus === 'success'
        ? 'text-emerald-400'
        : blueprintSyncStatus === 'error'
          ? 'text-rose-400'
          : 'text-foreground-muted';

  return (
    <div className="fixed inset-0 z-[var(--z-tool)] bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="blueprints-gallery-title"
        className="w-[95vw] h-[90vh] flex flex-col bg-surface rounded-xl border border-white/10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <AuricIcon name="library_books" className="text-primary-light text-[20px]" />
            <h2 id="blueprints-gallery-title" className="text-sm font-bold text-foreground">
              Blueprints
            </h2>
            {blueprintServerUrl && blueprintSyncStatus !== 'idle' && syncIcon && (
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
                className={syncColor}
              >
                <AuricIcon
                  name={syncIcon}
                  className={`text-[14px] ${blueprintSyncStatus === 'syncing' ? 'animate-spin' : ''}`}
                />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditTarget(null);
                setBlueprintsModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
            >
              <AuricIcon name="add" className="text-[14px]" />
              New
            </button>
            <button
              onClick={() => setBlueprintsGalleryOpen(false)}
              className="rounded-lg p-1.5 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
              aria-label="Close blueprints gallery"
            >
              <AuricIcon name="close" className="text-[18px]" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <BlueprintListColumn
            search={search}
            onSearchChange={setSearch}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            complexityFilter={complexityFilter}
            onComplexityFilterChange={setComplexityFilter}
            filtered={filtered}
            totalDraftCount={blueprintsDraft.length}
            selectedBlueprintId={selectedBlueprintId}
            onSelectBlueprint={setSelectedBlueprintId}
            onCreateNew={() => {
              setEditTarget(null);
              setBlueprintsModalOpen(true);
            }}
            isDirty={blueprintsDirty}
            onDiscard={discardBlueprintChanges}
            onSave={() => rootPath && persistInBackground(saveBlueprints(rootPath))}
          />

          <BlueprintDetailPane
            blueprint={selectedBlueprint}
            onRead={() => setReadingOpen(true)}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {readingOpen && selectedBlueprint && (
        <BlueprintReadingOverlay
          blueprint={selectedBlueprint}
          onBack={() => setReadingOpen(false)}
          onEdit={() => handleEdit(selectedBlueprint)}
        />
      )}

      <BlueprintCreateModal
        isOpen={blueprintsModalOpen}
        onSave={handleSave}
        onClose={() => {
          setBlueprintsModalOpen(false);
          setEditTarget(null);
        }}
        initialValues={editTarget ?? undefined}
      />

      {confirmDialog}
    </div>
  );
}
