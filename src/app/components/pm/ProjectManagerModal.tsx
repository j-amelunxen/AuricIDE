'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { EpicSidebar } from './EpicSidebar';
import { TicketTable } from './TicketTable';
import { TicketEditPanel } from './TicketEditPanel';
import { EpicEditDialog } from './EpicEditDialog';
import { TicketCreateModal } from './TicketCreateModal';
import { DependencyTreeView } from './DependencyTreeView';
import { MetricsView } from './MetricsView';
import type { PmEpic, PmTicket } from '@/lib/tauri/pm';
import { generateTicketPrompt } from '@/lib/pm/prompt';

const EMPTY: never[] = [];

export function ProjectManagerModal() {
  const pmModalOpen = useStore((s) => s.pmModalOpen);
  const pmDirty = useStore((s) => s.pmDirty);
  const draftEpics = useStore((s) => s.pmDraftEpics) ?? EMPTY;
  const draftTickets = useStore((s) => s.pmDraftTickets) ?? EMPTY;
  const draftTestCases = useStore((s) => s.pmDraftTestCases) ?? EMPTY;
  const draftDependencies = useStore((s) => s.pmDraftDependencies) ?? EMPTY;
  const selectedEpicId = useStore((s) => s.pmSelectedEpicId);
  const selectedTicketId = useStore((s) => s.pmSelectedTicketId);
  const rootPath = useStore((s) => s.rootPath);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);
  const setImportSpecDialogOpen = useStore((s) => s.setImportSpecDialogOpen);

  const setPmModalOpen = useStore((s) => s.setPmModalOpen);
  const loadPmData = useStore((s) => s.loadPmData);
  const refreshPmData = useStore((s) => s.refreshPmData);
  const savePmData = useStore((s) => s.savePmData);
  const discardPmChanges = useStore((s) => s.discardPmChanges);
  const addEpic = useStore((s) => s.addEpic);
  const updateEpic = useStore((s) => s.updateEpic);
  const deleteEpic = useStore((s) => s.deleteEpic);
  const addTicket = useStore((s) => s.addTicket);
  const updateTicket = useStore((s) => s.updateTicket);
  const deleteTicket = useStore((s) => s.deleteTicket);
  const moveTicket = useStore((s) => s.moveTicket);
  const addTestCase = useStore((s) => s.addTestCase);
  const updateTestCase = useStore((s) => s.updateTestCase);
  const deleteTestCase = useStore((s) => s.deleteTestCase);
  const addDependency = useStore((s) => s.addDependency);
  const removeDependency = useStore((s) => s.removeDependency);
  const setPmSelectedEpicId = useStore((s) => s.setPmSelectedEpicId);
  const setPmSelectedTicketId = useStore((s) => s.setPmSelectedTicketId);
  const archiveDoneTickets = useStore((s) => s.archiveDoneTickets);

  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<PmEpic | null>(null);
  const [ticketCreateOpen, setTicketCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tree' | 'metrics'>('list');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (pmModalOpen && rootPath) {
      loadPmData(rootPath);
    }
  }, [pmModalOpen, rootPath, loadPmData]);

  useEffect(() => {
    if (!pmModalOpen || !rootPath) return;
    const id = setInterval(() => refreshPmData(rootPath), 30_000);
    return () => clearInterval(id);
  }, [pmModalOpen, rootPath, refreshPmData]);

  const handleClose = useCallback(() => {
    if (pmDirty) {
      if (!confirm('Discard unsaved changes?')) return;
      discardPmChanges();
    }
    setPmModalOpen(false);
  }, [pmDirty, discardPmChanges, setPmModalOpen]);

  const handleSave = useCallback(async () => {
    if (!rootPath) return;
    await savePmData(rootPath);
  }, [rootPath, savePmData]);

  const handleSaveAndClose = useCallback(async () => {
    await handleSave();
    setPmModalOpen(false);
  }, [handleSave, setPmModalOpen]);

  useEffect(() => {
    if (!pmModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (pmDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pmModalOpen, handleClose, handleSave, pmDirty]);

  const filteredTickets = (
    selectedEpicId === null ? draftTickets : draftTickets.filter((t) => t.epicId === selectedEpicId)
  ).filter((t) => (showArchived ? t.status === 'archived' : t.status !== 'archived'));

  const selectedTicket = draftTickets.find((t) => t.id === selectedTicketId) ?? null;

  const ticketTestCases = selectedTicket
    ? draftTestCases.filter((tc) => tc.ticketId === selectedTicket.id)
    : [];

  const ticketDependencies = selectedTicket
    ? draftDependencies.filter((d) => d.sourceId === selectedTicket.id)
    : [];

  const availableItems = useMemo(
    () => [
      ...draftEpics.map((e) => ({ id: e.id, type: 'epic' as const, name: e.name })),
      ...draftTickets.map((t) => ({
        id: t.id,
        type: 'ticket' as const,
        name: t.name,
        status: t.status,
      })),
    ],
    [draftEpics, draftTickets]
  );

  const handleSpawnAgent = useCallback(
    async (ticketId: string) => {
      const ticket = draftTickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      updateTicket(ticket.id, { status: 'in_progress' });
      if (rootPath) {
        await savePmData(rootPath);
      }

      const ticketTestCases = draftTestCases.filter((tc) => tc.ticketId === ticket.id);
      const ticketDependencies = draftDependencies.filter((d) => d.sourceId === ticket.id);

      const prompt = await generateTicketPrompt(
        ticket,
        ticketTestCases,
        ticketDependencies,
        availableItems,
        rootPath
      );
      setInitialAgentTask(prompt);
      setSpawnAgentTicketId(ticket.id);
      setSpawnDialogOpen(true);
    },
    [
      draftTickets,
      updateTicket,
      savePmData,
      rootPath,
      draftTestCases,
      draftDependencies,
      availableItems,
      setInitialAgentTask,
      setSpawnAgentTicketId,
      setSpawnDialogOpen,
    ]
  );

  const handleOpenCreateTicket = useCallback(() => {
    setTicketCreateOpen(true);
  }, []);

  const handleTicketCreate = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      const now = new Date().toISOString();
      addTicket({
        ...ticketData,
        statusUpdatedAt: now,
        sortOrder: draftTickets.length,
        createdAt: now,
        updatedAt: now,
      });
      dependencies.forEach((dep) => addDependency(dep));
    },
    [draftTickets.length, addTicket, addDependency]
  );

  const handleTicketCreateAndClose = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      handleTicketCreate(ticketData, dependencies);
      setTicketCreateOpen(false);
    },
    [handleTicketCreate]
  );

  const handleAddTestCase = useCallback(() => {
    if (!selectedTicket) return;
    const now = new Date().toISOString();
    addTestCase({
      id: crypto.randomUUID(),
      ticketId: selectedTicket.id,
      title: '',
      body: '',
      sortOrder: ticketTestCases.length,
      createdAt: now,
      updatedAt: now,
    });
  }, [selectedTicket, ticketTestCases.length, addTestCase]);

  const handleEpicDialogSave = useCallback(
    (name: string, description: string) => {
      if (editingEpic) {
        updateEpic(editingEpic.id, { name, description });
      } else {
        const now = new Date().toISOString();
        addEpic({
          id: crypto.randomUUID(),
          name,
          description,
          sortOrder: draftEpics.length,
          createdAt: now,
          updatedAt: now,
        });
      }
    },
    [editingEpic, updateEpic, addEpic, draftEpics.length]
  );

  const handleEpicDialogSaveAndClose = useCallback(
    (name: string, description: string) => {
      handleEpicDialogSave(name, description);
      setEpicDialogOpen(false);
      setEditingEpic(null);
    },
    [handleEpicDialogSave]
  );

  const handleEditEpic = useCallback((epic: PmEpic) => {
    setEditingEpic(epic);
    setEpicDialogOpen(true);
  }, []);

  const handleAddEpic = useCallback(() => {
    setEditingEpic(null);
    setEpicDialogOpen(true);
  }, []);

  if (!pmModalOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-sm" onClick={handleClose} />

      <div className="fixed inset-3 z-[201] flex flex-col bg-[#09090f] border border-white/[0.08] rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.8)]">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] bg-white/[0.015] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[15px] text-primary-light/40 select-none">
              checklist
            </span>
            <h2 className="text-sm font-semibold text-foreground tracking-tight">
              Project Management
            </h2>
            {pmDirty && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-yellow-400/80 animate-pulse"
                title="Unsaved changes"
              />
            )}

            <div className="h-4 w-px bg-white/10 mx-2" />
            <div className="flex bg-white/5 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  viewMode === 'list'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setViewMode('tree')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  viewMode === 'tree'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                Tree
              </button>
              <button
                onClick={() => setViewMode('metrics')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  viewMode === 'metrics'
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                Metrics
              </button>
            </div>

            <div className="h-4 w-px bg-white/10 mx-2" />
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                showArchived
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                  : 'bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {showArchived ? 'inventory_2' : 'archive'}
              </span>
              {showArchived ? 'Archive View' : 'Archive'}
            </button>

            <div className="h-4 w-px bg-white/10 mx-2" />
            <button
              onClick={() => setImportSpecDialogOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground transition-all"
            >
              <span className="material-symbols-outlined text-[14px]">description</span>
              Import Spec
            </button>

            {!showArchived && (
              <button
                onClick={archiveDoneTickets}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground"
                title="Move all 'Done' tickets to Archive"
              >
                <span className="material-symbols-outlined text-[14px]">archive</span>
                Move Done to Archive
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!pmDirty}
              onClick={handleSave}
              className="rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              Save
            </button>
            <button
              type="button"
              disabled={!pmDirty}
              onClick={handleSaveAndClose}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-primary/80 transition-all"
            >
              Save and Close
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        {viewMode === 'metrics' ? (
          <div className="flex-1 min-h-0">
            <MetricsView />
          </div>
        ) : viewMode === 'tree' ? (
          <div className="flex-1 min-h-0">
            <DependencyTreeView
              epics={draftEpics}
              tickets={filteredTickets}
              dependencies={draftDependencies}
              onSpawnAgent={handleSpawnAgent}
              onSelectEpic={setPmSelectedEpicId}
              onUpdateTicket={updateTicket}
            />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Epics panel */}
            <div className="w-[220px] shrink-0">
              <EpicSidebar
                epics={draftEpics}
                tickets={draftTickets}
                selectedEpicId={selectedEpicId}
                onSelectEpic={setPmSelectedEpicId}
                onAddEpic={handleAddEpic}
                onEditEpic={handleEditEpic}
                onDeleteEpic={deleteEpic}
              />
            </div>

            {/* Ticket list */}
            <div className="w-[280px] shrink-0 border-l border-r border-white/[0.08]">
              <TicketTable
                tickets={filteredTickets}
                allTickets={draftTickets}
                testCases={draftTestCases}
                selectedTicketId={selectedTicketId}
                dependencies={draftDependencies}
                onSelectTicket={setPmSelectedTicketId}
                onUpdateTicket={updateTicket}
                onSave={handleSave}
                onAddTicket={handleOpenCreateTicket}
              />
            </div>

            {/* Detail panel */}
            <div className="flex-1 min-w-0">
              <TicketEditPanel
                ticket={selectedTicket}
                epics={draftEpics}
                allTickets={draftTickets}
                testCases={ticketTestCases}
                dependencies={ticketDependencies}
                availableItems={availableItems}
                onUpdateTicket={updateTicket}
                onSave={handleSave}
                onSaveAndClose={handleSaveAndClose}
                onCancel={() => setPmSelectedTicketId(null)}
                onDeleteTicket={(id) => {
                  deleteTicket(id);
                  setPmSelectedTicketId(null);
                }}
                onMoveTicket={moveTicket}
                onAddTestCase={handleAddTestCase}
                onUpdateTestCase={updateTestCase}
                onDeleteTestCase={deleteTestCase}
                onAddDependency={addDependency}
                onRemoveDependency={removeDependency}
              />
            </div>
          </div>
        )}
      </div>

      <EpicEditDialog
        isOpen={epicDialogOpen}
        epic={editingEpic}
        onSave={handleEpicDialogSave}
        onSaveAndClose={handleEpicDialogSaveAndClose}
        onClose={() => {
          setEpicDialogOpen(false);
          setEditingEpic(null);
        }}
      />

      <TicketCreateModal
        isOpen={ticketCreateOpen}
        epics={draftEpics}
        allTickets={draftTickets}
        availableItems={availableItems}
        defaultEpicId={selectedEpicId}
        onSave={handleTicketCreate}
        onSaveAndClose={handleTicketCreateAndClose}
        onClose={() => setTicketCreateOpen(false)}
      />
    </>,
    document.body
  );
}
