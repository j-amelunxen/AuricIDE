'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { PersistChip } from '@/app/components/ui/PersistChip';
import { useConductorController } from '@/lib/hooks/useConductorController';
import { GoalTree } from './GoalTree';
import { GoalDetailPanel } from './GoalDetailPanel';
import { GoalCreateDialog } from './GoalCreateDialog';
import { ConductorPanel } from './ConductorPanel';
import { GoalsWorkflowStrip, WORKFLOW_STRIP_DISMISSED_KEY } from './GoalsWorkflowStrip';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { persistInBackground, persistQuietly } from '@/lib/store/persistFeedback';
import { planGoalMove, type GoalDropPosition } from '@/lib/store/goalsSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Builds the launch prompt for a goal: explicit goalPrompt wins, else generated. */
export function buildGoalLaunchPrompt(goal: PmGoal, stations: PmGoalStation[] = []): string {
  const parts = [`# Goal: ${goal.name} (goalId: ${goal.id})`];
  if (goal.goalPrompt.trim()) {
    parts.push(`## Goal instructions\n${goal.goalPrompt}`);
  } else {
    if (goal.description) parts.push(goal.description);
    if (goal.successCriteria) parts.push(`## Success criteria\n${goal.successCriteria}`);
  }
  const savedLine = stations
    .filter((station) => station.goalId === goal.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (savedLine.length > 0) {
    parts.push(
      `## Saved line\n${savedLine
        .map(
          (station, index) =>
            `${index + 1}. ${station.name} (stationId: ${station.id}${station.kind === 'human' ? ', human' : ''})`
        )
        .join('\n')}`
    );
  }
  parts.push(
    '## Working agreement\n' +
      `Work autonomously toward this goal. Its goalId is "${goal.id}". Use this exact ` +
      'value with the auric-pm MCP tools, do not look it up by name. If those tools are ' +
      'available, first call list_epics and reuse an appropriate epic; if none exists, call ' +
      `create_epic with the name "${goal.name}". Pass the resulting epicId to every ` +
      `create_ticket (goalId: "${goal.id}") to create executable tickets in the saved order. ` +
      'Human checkpoints must also become tickets with needsHumanSupervision: true. After each ' +
      "ticket is created, call update_station with that checkpoint's stationId and the returned " +
      "ticketId to link them. Preserve the saved line's intent and order. Use " +
      `evaluate_goal (id: "${goal.id}") ` +
      'to check progress, and record findings as context items or via write_finding. Do NOT ' +
      'call record_goal_run: this run is already recorded. Exit when the success ' +
      'criteria are met or you are blocked.'
  );
  // Launching an agent for a goal invokes the /goal command first.
  return `/goal\n\n${parts.join('\n\n')}`;
}

export function GoalsModal() {
  const goalsModalOpen = useStore((s) => s.goalsModalOpen);
  if (!goalsModalOpen) return null;
  return <GoalsPanel />;
}

export function GoalsPanel({ embedded = false }: { embedded?: boolean }) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const goalsModalOpen = useStore((s) => s.goalsModalOpen);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const goalRunsDraft = useStore((s) => s.goalRunsDraft);
  const goalRequirementLinksDraft = useStore((s) => s.goalRequirementLinksDraft);
  const goalStationsDraft = useStore((s) => s.goalStationsDraft);
  const goalsDirty = useStore((s) => s.goalsDirty);
  const selectedGoalId = useStore((s) => s.selectedGoalId);
  const rootPath = useStore((s) => s.rootPath);
  const tickets = useStore((s) => s.pmDraftTickets);
  const requirements = useStore((s) => s.requirementsDraft);
  const agents = useStore((s) => s.agents);

  const conductor = useConductorController();

  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setOrchestrationOpen = useStore((s) => s.setOrchestrationOpen);
  const setGoalLinesOpen = useStore((s) => s.setGoalLinesOpen);
  const setWorkTab = useStore((s) => s.setWorkTab);
  const loadGoals = useStore((s) => s.loadGoals);
  const goalsLoading = useStore((s) => s.goalsLoading);
  const goalsLoadError = useStore((s) => s.goalsLoadError);
  const saveGoals = useStore((s) => s.saveGoals);
  const discardGoalChanges = useStore((s) => s.discardGoalChanges);
  const addGoal = useStore((s) => s.addGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const deleteGoal = useStore((s) => s.deleteGoal);
  const achieveGoal = useStore((s) => s.achieveGoal);
  const linkRequirementToGoal = useStore((s) => s.linkRequirementToGoal);
  const unlinkRequirementFromGoal = useStore((s) => s.unlinkRequirementFromGoal);
  const loadPmData = useStore((s) => s.loadPmData);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const updateTicket = useStore((s) => s.updateTicket);
  const savePmData = useStore((s) => s.savePmData);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const setSpawnAgentGoalId = useStore((s) => s.setSpawnAgentGoalId);

  const { confirm, confirmDialog } = useConfirm();

  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [workflowStripVisible, setWorkflowStripVisible] = useState(
    () =>
      typeof window === 'undefined' || localStorage.getItem(WORKFLOW_STRIP_DISMISSED_KEY) !== '1'
  );

  const dismissWorkflowStrip = useCallback(() => {
    localStorage.setItem(WORKFLOW_STRIP_DISMISSED_KEY, '1');
    setWorkflowStripVisible(false);
  }, []);

  const toggleWorkflowStrip = useCallback(() => {
    if (workflowStripVisible) {
      dismissWorkflowStrip();
    } else {
      localStorage.removeItem(WORKFLOW_STRIP_DISMISSED_KEY);
      setWorkflowStripVisible(true);
    }
  }, [workflowStripVisible, dismissWorkflowStrip]);

  const active = embedded || goalsModalOpen;

  useEffect(() => {
    if (active && rootPath) {
      loadGoals(rootPath);
      loadPmData(rootPath);
      loadRequirements(rootPath);
    }
  }, [active, rootPath, loadGoals, loadPmData, loadRequirements]);

  const handleClose = useCallback(async () => {
    if (goalsDirty) {
      const go = await confirm({
        title: 'Discard changes?',
        message: 'Discard unsaved changes?',
        confirmLabel: 'Discard',
        variant: 'discard',
      });
      if (!go) return;
      discardGoalChanges();
    }
    setGoalsModalOpen(false);
  }, [goalsDirty, confirm, discardGoalChanges, setGoalsModalOpen]);

  // The store toasts on failure; swallow here so a failed save cannot surface
  // as an unhandled rejection instead of a message.
  const handleSave = useCallback(async () => {
    if (!rootPath) return;
    await persistQuietly(saveGoals(rootPath));
  }, [rootPath, saveGoals]);

  useOverlayLayer({
    id: 'goals',
    kind: 'tool',
    active: !embedded && goalsModalOpen,
    onEscape: handleClose,
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (goalsDirty) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, handleSave, goalsDirty]);

  const selectedGoal = useMemo(
    () => goalsDraft.find((g) => g.id === selectedGoalId) ?? null,
    [goalsDraft, selectedGoalId]
  );

  const activeAgentsByGoal = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of agents) {
      if (agent.status === 'running' && agent.spawnedByGoalId) {
        counts[agent.spawnedByGoalId] = (counts[agent.spawnedByGoalId] ?? 0) + 1;
      }
    }
    return counts;
  }, [agents]);

  const handleCreate = useCallback(
    (goal: PmGoal) => {
      if (!rootPath) return;
      addGoal(goal);
      setSelectedGoalId(goal.id);
    },
    [addGoal, setSelectedGoalId, rootPath]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const go = await confirm({
        title: 'Delete this goal?',
        message: 'Delete this goal and its entire subtree?',
        confirmLabel: 'Delete',
      });
      if (!go) return;
      deleteGoal(id);
      if (selectedGoalId === id) setSelectedGoalId(null);
    },
    [confirm, deleteGoal, selectedGoalId, setSelectedGoalId]
  );

  const handleAddSubGoal = useCallback(
    (parentId: string) => {
      if (!rootPath) return;
      setCreateParentId(parentId);
      setCreateOpen(true);
    },
    [rootPath]
  );

  const handleMoveGoal = useCallback(
    (draggedId: string, targetId: string, position: GoalDropPosition) => {
      for (const update of planGoalMove(goalsDraft, draggedId, targetId, position)) {
        updateGoal(update.id, { parentId: update.parentId, sortOrder: update.sortOrder });
      }
    },
    [goalsDraft, updateGoal]
  );

  const handleLinkTicket = useCallback(
    (goalId: string, ticketId: string) => {
      updateTicket(ticketId, { goalId });
      if (rootPath) persistInBackground(savePmData(rootPath));
    },
    [updateTicket, savePmData, rootPath]
  );

  const handleUnlinkTicket = useCallback(
    (ticketId: string) => {
      updateTicket(ticketId, { goalId: null });
      if (rootPath) persistInBackground(savePmData(rootPath));
    },
    [updateTicket, savePmData, rootPath]
  );

  // Opens the shared spawn dialog prefilled for this goal, so the user picks
  // provider/model (and repo/permission mode) before the agent actually starts.
  const handleLaunchAgent = useCallback(
    (goal: PmGoal) => {
      setInitialAgentTask(buildGoalLaunchPrompt(goal, goalStationsDraft));
      setSpawnAgentGoalId(goal.id);
      setSpawnDialogOpen(true);
    },
    [goalStationsDraft, setInitialAgentTask, setSpawnAgentGoalId, setSpawnDialogOpen]
  );

  const body = (
    <>
      <div
        ref={embedded ? undefined : dialogRef}
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-labelledby="goals-modal-title"
        data-testid={embedded ? 'work-panel-goals' : 'goals-modal'}
        className={
          embedded
            ? 'flex h-full w-full flex-col bg-background-dark'
            : 'flex h-[85vh] w-[90vw] max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-background-dark shadow-2xl'
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-3">
            <AuricIcon name="flag" className="text-primary-light" />
            <h1 id="goals-modal-title" className="text-sm font-bold text-foreground">
              Goals
            </h1>
            <span className="text-[10px] text-foreground-muted">{goalsDraft.length} total</span>
            <PersistChip dirty={goalsDirty} />
          </div>

          <div className="flex items-center gap-2">
            <button
              data-testid="goals-help-btn"
              onClick={toggleWorkflowStrip}
              title="How goals work"
              aria-label="How goals work"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
            >
              <AuricIcon name="help" className="text-base" />
            </button>
            <button
              data-testid="goals-orchestration-btn"
              onClick={() => {
                if (!embedded) setGoalsModalOpen(false);
                setOrchestrationOpen(true);
              }}
              title="Orchestration graph"
              className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/10 transition-colors"
            >
              <AuricIcon name="graph_3" className="text-sm" />
              Orchestration
            </button>
            <button
              data-testid="goals-goal-lines-btn"
              onClick={() => {
                if (embedded) {
                  setWorkTab('lines');
                  return;
                }
                setGoalsModalOpen(false);
                setGoalLinesOpen(true, { fromGoals: true });
              }}
              title="Goal station map"
              className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/10 transition-colors"
            >
              <AuricIcon name="route" className="text-sm" />
              Goal Lines
            </button>
            <button
              data-testid="goals-create-btn"
              onClick={() => {
                if (!rootPath) return;
                setCreateParentId(null);
                setCreateOpen(true);
              }}
              disabled={!rootPath}
              title={rootPath ? undefined : 'Open a project to create goals'}
              className="rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              + New goal
            </button>
            {goalsDirty && (
              <button
                data-testid="goals-save-btn"
                onClick={handleSave}
                className="rounded-lg bg-green-500/15 border border-green-500/20 px-3 py-1.5 text-xs font-bold text-green-300 hover:bg-green-500/25 transition-colors"
              >
                Save
              </button>
            )}
            {!embedded && (
              <button
                data-testid="goals-close-btn"
                aria-label="Close"
                onClick={() => void handleClose()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
              >
                <AuricIcon name="close" className="text-base" />
              </button>
            )}
          </div>
        </div>

        {workflowStripVisible && <GoalsWorkflowStrip onDismiss={dismissWorkflowStrip} />}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-[420px] flex-col border-r border-white/5">
            <GoalTree
              goals={goalsDraft}
              tickets={tickets}
              selectedId={selectedGoalId}
              onSelect={setSelectedGoalId}
              onMoveGoal={handleMoveGoal}
              onDelete={(id) => void handleDelete(id)}
              onAddSubGoal={rootPath ? handleAddSubGoal : undefined}
              activeAgentsByGoal={activeAgentsByGoal}
              loading={goalsLoading}
              loadError={goalsLoadError}
              onCreate={
                rootPath
                  ? () => {
                      setCreateParentId(null);
                      setCreateOpen(true);
                    }
                  : undefined
              }
            />
          </div>

          <div className="flex flex-1 flex-col overflow-hidden">
            <GoalDetailPanel
              goal={selectedGoal}
              goals={goalsDraft}
              tickets={tickets}
              requirements={requirements}
              requirementLinks={goalRequirementLinksDraft}
              runs={goalRunsDraft}
              onUpdate={updateGoal}
              onDelete={(id) => void handleDelete(id)}
              onAchieve={achieveGoal}
              onAddSubGoal={handleAddSubGoal}
              onLaunchAgent={handleLaunchAgent}
              onLinkRequirement={linkRequirementToGoal}
              onUnlinkRequirement={unlinkRequirementFromGoal}
              onLinkTicket={handleLinkTicket}
              onUnlinkTicket={handleUnlinkTicket}
            />
          </div>
        </div>

        {/* Conductor */}
        <ConductorPanel {...conductor} />
      </div>

      {createOpen && (
        <GoalCreateDialog
          key={createParentId ?? 'root'}
          isOpen={createOpen}
          goals={goalsDraft}
          defaultParentId={createParentId}
          onSave={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}

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
