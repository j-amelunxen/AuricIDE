'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { PersistChip } from '@/app/components/ui/PersistChip';
import { EpicSidebar } from './EpicSidebar';
import { TicketTable } from './TicketTable';
import { TicketEditPanel } from './TicketEditPanel';
import { EpicEditDialog } from './EpicEditDialog';
import { TicketCreateModal } from './TicketCreateModal';
import { DependencyTreeView } from './DependencyTreeView';
import { MetricsView } from './MetricsView';
import type { PmEpic, PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';
import { isHiddenTicketStatus } from '@/lib/pm/enums';
import { generateTicketPrompt } from '@/lib/pm/prompt';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

const EMPTY: never[] = [];

/** "1 ticket" / "3 tickets" — the count is the point, so it always leads. */
function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

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

  // Deleting an epic takes every ticket under it and every test case under
  // those tickets with it, from a 20px icon that only exists on hover. The
  // question has to state the size of that, or it is not a real question.
  const handleDeleteEpic = useCallback(
    async (id: string) => {
      const ticketIds = draftTickets.filter((t) => t.epicId === id).map((t) => t.id);
      const testCaseCount = draftTestCases.filter((tc) => ticketIds.includes(tc.ticketId)).length;

      let message: string;
      if (ticketIds.length === 0) {
        message = 'This deletes the epic. It has no tickets.';
      } else {
        message = `This deletes the epic and its ${count(ticketIds.length, 'ticket')}`;
        message += testCaseCount > 0 ? `, along with ${count(testCaseCount, 'test case')}.` : '.';
      }

      const go = await confirm({
        title: 'Delete this epic?',
        message,
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
        message:
          testCaseCount === 0
            ? 'This deletes the ticket. It has no test cases.'
            : `This deletes the ticket and its ${count(testCaseCount, 'test case')}.`,
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
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-white/[0.015] px-5 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <AuricIcon name="checklist" className="text-[15px] text-primary-light/40 select-none" />
            <h2
              id="project-manager-title"
              className="text-sm font-semibold text-foreground tracking-tight"
            >
              {embedded ? 'Tickets' : 'Project Management'}
            </h2>
            <PersistChip dirty={pmDirty} />

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
              <AuricIcon name={showArchived ? 'inventory_2' : 'archive'} className="text-[14px]" />
              {showArchived ? 'Archive View' : 'Archive'}
            </button>

            <div className="h-4 w-px bg-white/10 mx-2" />
            <button
              onClick={() => setImportSpecDialogOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground transition-all"
            >
              <AuricIcon name="description" className="text-[14px]" />
              Import Spec
            </button>

            {!showArchived && (
              <button
                onClick={archiveDoneTickets}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground"
                title="Move all 'Done' tickets to Archive"
              >
                <AuricIcon name="archive" className="text-[14px]" />
                Move Done to Archive
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {!embedded && (
              <button
                type="button"
                onClick={() => void handleClose()}
                className="rounded-lg px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 transition-colors"
              >
                Close
              </button>
            )}
            <button
              type="button"
              disabled={!pmDirty}
              onClick={handleSave}
              className="rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              Save
            </button>
            {!embedded && (
              <button
                type="button"
                disabled={!pmDirty}
                onClick={handleSaveAndClose}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-primary/80 transition-all"
              >
                Save and Close
              </button>
            )}
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
          <div
            data-testid="tickets-columns"
            className="@container flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {/* Epics + list shrink when the agents bar is open, so the
                detail pane keeps a usable width instead of clipping. */}
            <div data-testid="tickets-epics-col" className="w-40 min-w-0 shrink-0 @4xl:w-[220px]">
              <EpicSidebar
                epics={draftEpics}
                tickets={draftTickets}
                selectedEpicId={selectedEpicId}
                onSelectEpic={setPmSelectedEpicId}
                onAddEpic={handleAddEpic}
                onEditEpic={handleEditEpic}
                onDeleteEpic={(id) => void handleDeleteEpic(id)}
              />
            </div>

            {/* Ticket list */}
            <div
              data-testid="tickets-list-col"
              className="w-52 min-w-0 shrink-0 border-l border-r border-white/[0.08] @4xl:w-[280px]"
            >
              <TicketTable
                loading={pmLoading}
                loadError={pmLoadError}
                tickets={filteredTickets}
                allTickets={draftTickets}
                testCases={draftTestCases}
                selectedTicketId={selectedTicketId}
                dependencies={draftDependencies}
                onSelectTicket={setPmSelectedTicketId}
                onUpdateTicket={updateTicket}
                onSave={async () => {
                  await handleSave();
                }}
                onAddTicket={handleOpenCreateTicket}
              />
            </div>

            {/* Detail panel */}
            <div data-testid="tickets-detail-col" className="min-w-0 flex-1">
              <TicketEditPanel
                ticket={selectedTicket}
                epics={draftEpics}
                allTickets={draftTickets}
                testCases={ticketTestCases}
                dependencies={ticketDependencies}
                availableItems={availableItems}
                onUpdateTicket={updateTicket}
                onSave={async () => {
                  await handleSave();
                }}
                onCancel={() => setPmSelectedTicketId(null)}
                onDeleteTicket={(id) => void handleDeleteTicket(id)}
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
