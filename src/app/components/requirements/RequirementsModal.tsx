'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { PersistChip } from '@/app/components/ui/PersistChip';
import { RequirementFilterPanel } from './RequirementFilterPanel';
import { RequirementList } from './RequirementList';
import { RequirementDetailPanel } from './RequirementDetailPanel';
import { RequirementCreateDialog } from './RequirementCreateDialog';
import type { PmRequirement } from '@/lib/tauri/requirements';
import { persistQuietly } from '@/lib/store/persistFeedback';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export function RequirementsPanel({ embedded = false }: { embedded?: boolean }) {
  return <RequirementsDialog embedded={embedded} />;
}

function RequirementsDialog({ embedded = false }: { embedded?: boolean }) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const requirementsModalOpen = useStore((s) => s.requirementsModalOpen);
  const requirementsDraft = useStore((s) => s.requirementsDraft);
  const requirementsDirty = useStore((s) => s.requirementsDirty);
  const selectedRequirementId = useStore((s) => s.selectedRequirementId);
  const rootPath = useStore((s) => s.rootPath);

  const filterCategory = useStore((s) => s.requirementFilterCategory);
  const filterType = useStore((s) => s.requirementFilterType);
  const filterStatus = useStore((s) => s.requirementFilterStatus);
  const filterVerification = useStore((s) => s.requirementFilterVerification);
  const searchQuery = useStore((s) => s.requirementSearchQuery);

  const setRequirementsModalOpen = useStore((s) => s.setRequirementsModalOpen);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const saveRequirements = useStore((s) => s.saveRequirements);
  const discardRequirementChanges = useStore((s) => s.discardRequirementChanges);
  const addRequirement = useStore((s) => s.addRequirement);
  const updateRequirement = useStore((s) => s.updateRequirement);
  const deleteRequirement = useStore((s) => s.deleteRequirement);
  const verifyRequirement = useStore((s) => s.verifyRequirement);
  const setSelectedRequirementId = useStore((s) => s.setSelectedRequirementId);
  const setFilterCategory = useStore((s) => s.setRequirementFilterCategory);
  const setFilterType = useStore((s) => s.setRequirementFilterType);
  const setFilterStatus = useStore((s) => s.setRequirementFilterStatus);
  const setFilterVerification = useStore((s) => s.setRequirementFilterVerification);
  const setSearchQuery = useStore((s) => s.setRequirementSearchQuery);

  const { confirm, confirmDialog } = useConfirm();

  const [createOpen, setCreateOpen] = useState(false);

  const active = embedded || requirementsModalOpen;

  useEffect(() => {
    if (active && rootPath) {
      loadRequirements(rootPath);
    }
  }, [active, rootPath, loadRequirements]);

  const handleClose = useCallback(async () => {
    if (requirementsDirty) {
      const go = await confirm({
        title: 'Discard changes?',
        message: 'Discard unsaved changes?',
        confirmLabel: 'Discard',
        variant: 'discard',
      });
      if (!go) return;
      discardRequirementChanges();
    }
    setRequirementsModalOpen(false);
  }, [requirementsDirty, confirm, discardRequirementChanges, setRequirementsModalOpen]);

  // The store toasts on failure; swallow here so a failed save cannot surface
  // as an unhandled rejection instead of a message.
  const handleSave = useCallback(async () => {
    if (!rootPath) return;
    await persistQuietly(saveRequirements(rootPath));
  }, [rootPath, saveRequirements]);

  useOverlayLayer({
    id: 'requirements',
    kind: 'tool',
    active: !embedded && requirementsModalOpen,
    onEscape: handleClose,
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (requirementsDirty) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, handleSave, requirementsDirty]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const r of requirementsDraft) {
      if (r.category) cats.add(r.category);
    }
    return Array.from(cats).sort();
  }, [requirementsDraft]);

  const filtered = useMemo(() => {
    let result = requirementsDraft;
    if (filterCategory) result = result.filter((r) => r.category === filterCategory);
    if (filterType) result = result.filter((r) => r.type === filterType);
    if (filterStatus) result = result.filter((r) => r.status === filterStatus);
    if (filterVerification === 'fresh') {
      result = result.filter((r) => {
        if (r.lastVerifiedAt === null) return false;
        const age = Date.now() - Date.parse(r.lastVerifiedAt); // eslint-disable-line react-hooks/purity -- filter callback, not render
        return age <= 30 * 86400000;
      });
    } else if (filterVerification === 'stale') {
      result = result.filter((r) => {
        if (r.lastVerifiedAt === null) return false;
        const age = Date.now() - Date.parse(r.lastVerifiedAt); // eslint-disable-line react-hooks/purity -- filter callback, not render
        return age > 30 * 86400000;
      });
    } else if (filterVerification === 'unverified') {
      result = result.filter((r) => r.lastVerifiedAt === null);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.reqId.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q)
      );
    }
    return result;
  }, [
    requirementsDraft,
    filterCategory,
    filterType,
    filterStatus,
    filterVerification,
    searchQuery,
  ]);

  const selectedRequirement = useMemo(
    () => requirementsDraft.find((r) => r.id === selectedRequirementId) ?? null,
    [requirementsDraft, selectedRequirementId]
  );

  const handleCreate = useCallback(
    (req: PmRequirement) => {
      addRequirement(req);
    },
    [addRequirement]
  );

  // A requirement carries more than its text: its verification record and the
  // test links that prove it. Name both, so the user is not told afterwards.
  const handleDelete = useCallback(
    async (id: string) => {
      const req = requirementsDraft.find((r) => r.id === id);
      const subject = req ? req.reqId : 'this requirement';
      const go = await confirm({
        title: 'Delete this requirement?',
        message: `This deletes ${subject}, its verification history and its links to test cases.`,
        confirmLabel: 'Delete',
      });
      if (!go) return;
      deleteRequirement(id);
      if (selectedRequirementId === id) setSelectedRequirementId(null);
    },
    [confirm, requirementsDraft, deleteRequirement, selectedRequirementId, setSelectedRequirementId]
  );

  if (!embedded && !requirementsModalOpen) return null;

  const body = (
    <>
      <div
        ref={embedded ? undefined : dialogRef}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-labelledby="requirements-modal-title"
        data-testid={embedded ? 'work-panel-requirements' : 'requirements-modal'}
        className={
          embedded
            ? 'flex h-full w-full flex-col bg-background-dark'
            : 'flex h-[85vh] w-[90vw] max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-background-dark shadow-2xl'
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-3">
            <AuricIcon name="checklist" className="text-primary-light" />
            <h1 id="requirements-modal-title" className="text-sm font-bold text-foreground">
              Requirements
            </h1>
            <span className="text-[10px] text-foreground-muted">
              {requirementsDraft.length} total
            </span>
            <PersistChip dirty={requirementsDirty} />
          </div>

          <div className="flex items-center gap-2">
            <input
              data-testid="requirements-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search requirements..."
              className="w-52 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:ring-1 focus:ring-primary/30"
            />
            <button
              data-testid="requirements-create-btn"
              onClick={() => setCreateOpen(true)}
              className="rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
            >
              + New
            </button>
            {requirementsDirty && (
              <button
                data-testid="requirements-save-btn"
                onClick={handleSave}
                className="rounded-lg bg-green-500/15 border border-green-500/20 px-3 py-1.5 text-xs font-bold text-green-300 hover:bg-green-500/25 transition-colors"
              >
                Save
              </button>
            )}
            {!embedded && (
              <button
                data-testid="requirements-close-btn"
                aria-label="Close"
                onClick={() => void handleClose()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
              >
                <AuricIcon name="close" className="text-base" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <RequirementFilterPanel
            categories={categories}
            activeCategory={filterCategory}
            activeType={filterType}
            activeStatus={filterStatus}
            activeVerification={filterVerification}
            onCategoryChange={setFilterCategory}
            onTypeChange={setFilterType}
            onStatusChange={setFilterStatus}
            onVerificationChange={setFilterVerification}
          />

          <div className="flex flex-1 flex-col overflow-hidden">
            <RequirementList
              requirements={filtered}
              selectedId={selectedRequirementId}
              onSelect={setSelectedRequirementId}
              totalCount={requirementsDraft.length}
            />
          </div>

          <div className="flex w-[380px] flex-col border-l border-white/5">
            <RequirementDetailPanel
              requirement={selectedRequirement}
              onUpdate={updateRequirement}
              onDelete={(id) => void handleDelete(id)}
              onVerify={verifyRequirement}
            />
          </div>
        </div>
      </div>

      <RequirementCreateDialog
        isOpen={createOpen}
        existingRequirements={requirementsDraft}
        onSave={handleCreate}
        onClose={() => setCreateOpen(false)}
      />

      {confirmDialog}
    </>
  );

  if (embedded) return body;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) void handleClose();
      }}
    >
      {body}
    </div>,
    document.body
  );
}

export function RequirementsModal() {
  const requirementsModalOpen = useStore((s) => s.requirementsModalOpen);
  if (!requirementsModalOpen) return null;
  return <RequirementsDialog />;
}
