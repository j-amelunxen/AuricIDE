'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { RequirementFilterPanel } from './RequirementFilterPanel';
import { RequirementList } from './RequirementList';
import { RequirementDetailPanel } from './RequirementDetailPanel';
import { RequirementCreateDialog } from './RequirementCreateDialog';
import type { PmRequirement } from '@/lib/tauri/requirements';

export function RequirementsModal() {
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

  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (requirementsModalOpen && rootPath) {
      loadRequirements(rootPath);
    }
  }, [requirementsModalOpen, rootPath, loadRequirements]);

  const handleClose = useCallback(() => {
    if (requirementsDirty) {
      if (!confirm('Discard unsaved changes?')) return;
      discardRequirementChanges();
    }
    setRequirementsModalOpen(false);
  }, [requirementsDirty, discardRequirementChanges, setRequirementsModalOpen]);

  const handleSave = useCallback(async () => {
    if (!rootPath) return;
    await saveRequirements(rootPath);
  }, [rootPath, saveRequirements]);

  useEffect(() => {
    if (!requirementsModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createOpen) {
        handleClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (requirementsDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [requirementsModalOpen, createOpen, handleClose, handleSave, requirementsDirty]);

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
    async (req: PmRequirement) => {
      addRequirement(req);
      if (rootPath) await saveRequirements(rootPath);
    },
    [addRequirement, saveRequirements, rootPath]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteRequirement(id);
      if (selectedRequirementId === id) setSelectedRequirementId(null);
    },
    [deleteRequirement, selectedRequirementId, setSelectedRequirementId]
  );

  if (!requirementsModalOpen) return null;

  return createPortal(
    <div
      data-testid="requirements-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-background-dark shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary-light">checklist</span>
            <h1 className="text-sm font-bold text-foreground">Requirements</h1>
            <span className="text-[10px] text-foreground-muted">
              {requirementsDraft.length} total
            </span>
            {requirementsDirty && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                unsaved
              </span>
            )}
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
            <button
              data-testid="requirements-close-btn"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
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
            />
          </div>

          <div className="flex w-[380px] flex-col border-l border-white/5">
            <RequirementDetailPanel
              requirement={selectedRequirement}
              onUpdate={updateRequirement}
              onDelete={handleDelete}
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
    </div>,
    document.body
  );
}
