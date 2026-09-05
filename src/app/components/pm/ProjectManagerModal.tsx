'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { EpicEditDialog } from './EpicEditDialog';
import { TicketCreateModal } from './TicketCreateModal';
import { DependencyTreeView } from './DependencyTreeView';
import { MetricsView } from './MetricsView';
import type { PmEpic, PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';
import { isHiddenTicketStatus } from '@/lib/pm/enums';
import { generateTicketPrompt } from '@/lib/pm/prompt';
import { ProjectManagerHeader } from './modal/ProjectManagerHeader';
import { ProjectManagerColumns } from './modal/ProjectManagerColumns';
import { formatEpicDeleteMessage, formatTicketDeleteMessage } from './modal/pmModalHelpers';

export { ProjectManagerHeader } from './modal/ProjectManagerHeader';
export { ProjectManagerColumns } from './modal/ProjectManagerColumns';

const EMPTY: never[] = [];

export function TicketsPanel({ embedded = false }: { embedded?: boolean }) {
  return <ProjectManagerDialog embedded={embedded} />;
}

function ProjectManagerDialog({ embedded = false }: { embedded?: boolean }) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
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
  const pmLoading = useStore((s) => s.pmLoading);
  const pmLoadError = useStore((s) => s.pmLoadError);
  const discardPmChanges = useStore((s) => s.discardPmChanges);
  const addEpic = useStore((s) => s.addEpic);
  const updateEpic = useStore((s) => s.updateEpic);
  const deleteEpic = useStore((s) => s.deleteEpic);
  const addTicket = useStore((s) => s.addTicket);
  const updateTicket = useStore((s) => s.updateTicket);
  const deleteTicket = useStore((s) => s.deleteTicket);
  const moveTicket = useStore((s) => s.moveTicket);
  const reorderTickets = useStore((s) => s.reorderTickets);
  const reorderEpics = useStore((s) => s.reorderEpics);
  const addTestCase = useStore((s) => s.addTestCase);
  const updateTestCase = useStore((s) => s.updateTestCase);
  const deleteTestCase = useStore((s) => s.deleteTestCase);
  const addDependency = useStore((s) => s.addDependency);
  const removeDependency = useStore((s) => s.removeDependency);
  const setPmSelectedEpicId = useStore((s) => s.setPmSelectedEpicId);
  const setPmSelectedTicketId = useStore((s) => s.setPmSelectedTicketId);
  const archiveDoneTickets = useStore((s) => s.archiveDoneTickets);

  const { confirm, confirmDialog } = useConfirm();

  const [epicDialogOpen, setEpicDialogOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<PmEpic | null>(null);
  const [ticketCreateOpen, setTicketCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tree' | 'metrics'>('list');
  const [showArchived, setShowArchived] = useState(false);

  const active = embedded || pmModalOpen;

  useEffect(() => {
    if (active && rootPath) {
      loadPmData(rootPath);
    }
  }, [active, rootPath, loadPmData]);

  useEffect(() => {
    if (!active || !rootPath) return;
    const id = setInterval(() => refreshPmData(rootPath), 30_000);
    return () => clearInterval(id);
  }, [active, rootPath, refreshPmData]);

  const handleClose = useCallback(async () => {
    if (pmDirty) {
      const go = await confirm({
        title: 'Discard changes?',
        message: 'Discard unsaved changes?',
        confirmLabel: 'Discard',
        variant: 'discard',
      });
      if (!go) return;
      discardPmChanges();
    }
    setPmModalOpen(false);
  }, [pmDirty, confirm, discardPmChanges, setPmModalOpen]);

  /** Resolves true when the work is persisted. The store already toasts on
   *  failure, so callers only need the verdict. */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!rootPath) return false;
    try {
      await savePmData(rootPath);
      return true;
    } catch {
      return false;
    }
  }, [rootPath, savePmData]);

  const handleSaveAndClose = useCallback(async () => {
    // Closing on a failed save is how unsaved work disappears.
    if (await handleSave()) setPmModalOpen(false);
  }, [handleSave, setPmModalOpen]);

  useOverlayLayer({
    id: 'plan',
    kind: 'tool',
    active: !embedded && pmModalOpen,
    onEscape: handleClose,
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (pmDirty) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, handleSave, pmDirty]);

  const filteredTickets = (
    selectedEpicId === null ? draftTickets : draftTickets.filter((t) => t.epicId === selectedEpicId)
  ).filter((t) =>
    showArchived ? isHiddenTicketStatus(t.status) : !isHiddenTicketStatus(t.status)
  );

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

      const testCases = draftTestCases.filter((tc) => tc.ticketId === ticket.id);
      const dependencies = draftDependencies.filter((d) => d.sourceId === ticket.id);

      const prompt = await generateTicketPrompt(
        ticket,
        testCases,
        dependencies,
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

  const handleAddTestCase = useCallback(
    (initial?: Partial<PmTestCase>) => {
      if (!selectedTicket) return;
      const now = new Date().toISOString();
      addTestCase({
        id: crypto.randomUUID(),
        ticketId: selectedTicket.id,
        title: initial?.title || '',
        body: initial?.body || '',
        sortOrder: ticketTestCases.length,
        createdAt: now,
        updatedAt: now,
      });
    },
    [selectedTicket, addTestCase, ticketTestCases.length]
  );

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

  const handleDeleteEpic = useCallback(
    async (id: string) => {
      const ticketIds = draftTickets.filter((t) => t.epicId === id).map((t) => t.id);
      const testCaseCount = draftTestCases.filter((tc) => ticketIds.includes(tc.ticketId)).length;

      const go = await confirm({
        title: 'Delete this epic?',
        message: formatEpicDeleteMessage(ticketIds.length, testCaseCount),
        confirmLabel: 'Delete',
      });
      if (!go) return;
      deleteEpic(id);
    },
    [confirm, deleteEpic, draftTickets, draftTestCases]
  );

  const handleDeleteTicket = useCallback(
    async (id: string) => {
      const testCaseCount = draftTestCases.filter((tc) => tc.ticketId === id).length;
      const go = await confirm({
        title: 'Delete this ticket?',
        message: formatTicketDeleteMessage(testCaseCount),
        confirmLabel: 'Delete',
      });
      if (!go) return;
      deleteTicket(id);
      setPmSelectedTicketId(null);
    },
    [confirm, deleteTicket, setPmSelectedTicketId, draftTestCases]
  );

  const handleEditEpic = useCallback((epic: PmEpic) => {
    setEditingEpic(epic);
    setEpicDialogOpen(true);
  }, []);

  const handleAddEpic = useCallback(() => {
    setEditingEpic(null);
    setEpicDialogOpen(true);
  }, []);

  if (!embedded && !pmModalOpen) return null;

  const frame = (
    <>
      <div
        ref={embedded ? undefined : dialogRef}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-labelledby="project-manager-title"
        data-testid={embedded ? 'work-panel-tickets' : undefined}
        className={
          embedded
            ? 'flex h-full w-full flex-col overflow-hidden bg-[#09090f]'
            : 'fixed inset-3 z-[201] flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#09090f] shadow-[0_32px_80px_rgba(0,0,0,0.8)]'
        }
      >
        <ProjectManagerHeader
          embedded={embedded}
          pmDirty={pmDirty}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(!showArchived)}
          onImportSpec={() => setImportSpecDialogOpen(true)}
          onArchiveDone={archiveDoneTickets}
          onClose={() => void handleClose()}
          onSave={() => void handleSave()}
          onSaveAndClose={() => void handleSaveAndClose()}
        />

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
          <ProjectManagerColumns
            draftEpics={draftEpics}
            draftTickets={draftTickets}
            filteredTickets={filteredTickets}
            draftTestCases={draftTestCases}
            draftDependencies={draftDependencies}
            selectedEpicId={selectedEpicId}
            selectedTicket={selectedTicket}
            selectedTicketId={selectedTicketId}
            ticketTestCases={ticketTestCases}
            ticketDependencies={ticketDependencies}
            availableItems={availableItems}
            pmLoading={pmLoading}
            pmLoadError={pmLoadError}
            onSelectEpic={setPmSelectedEpicId}
            onAddEpic={handleAddEpic}
            onEditEpic={handleEditEpic}
            onDeleteEpic={(id) => void handleDeleteEpic(id)}
            onReorderEpics={reorderEpics}
            onSelectTicket={setPmSelectedTicketId}
            onUpdateTicket={updateTicket}
            onSave={async () => {
              await handleSave();
            }}
            onOpenCreateTicket={handleOpenCreateTicket}
            onReorderTickets={reorderTickets}
            onDeleteTicket={(id) => void handleDeleteTicket(id)}
            onMoveTicket={moveTicket}
            onAddTestCase={handleAddTestCase}
            onUpdateTestCase={updateTestCase}
            onDeleteTestCase={deleteTestCase}
            onAddDependency={addDependency}
            onRemoveDependency={removeDependency}
          />
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
        onCreateEpic={() => {
          setTicketCreateOpen(false);
          handleAddEpic();
        }}
      />

      {confirmDialog}
    </>
  );

  if (embedded) return frame;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[var(--z-tool)] bg-black/75 backdrop-blur-sm"
        onClick={() => void handleClose()}
      />
      {frame}
    </>,
    document.body
  );
}

export function ProjectManagerModal() {
  const pmModalOpen = useStore((s) => s.pmModalOpen);
  if (!pmModalOpen) return null;
  return <ProjectManagerDialog />;
}
