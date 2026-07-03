'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { GoalTree } from './GoalTree';
import { GoalDetailPanel } from './GoalDetailPanel';
import { GoalCreateDialog } from './GoalCreateDialog';
import { ConductorPanel } from './ConductorPanel';
import type { PmGoal } from '@/lib/tauri/goals';

/** Builds the launch prompt for a goal: explicit goalPrompt wins, else generated. */
export function buildGoalLaunchPrompt(goal: PmGoal): string {
  if (goal.goalPrompt.trim()) return goal.goalPrompt;
  const parts = [`# Goal: ${goal.name}`];
  if (goal.description) parts.push(goal.description);
  if (goal.successCriteria) {
    parts.push(`## Success criteria\n${goal.successCriteria}`);
  }
  parts.push(
    '## Working agreement\n' +
      'Work autonomously toward this goal. If the auric-pm MCP tools are available, ' +
      'use decompose_goal / create_ticket to plan, evaluate_goal to check progress, ' +
      'and record findings as context items or via write_finding. Do NOT call ' +
      'record_goal_run — this run is already recorded. Exit when the success ' +
      'criteria are met or you are blocked.'
  );
  return parts.join('\n\n');
}

export function GoalsModal() {
  const goalsModalOpen = useStore((s) => s.goalsModalOpen);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const goalRunsDraft = useStore((s) => s.goalRunsDraft);
  const goalRequirementLinksDraft = useStore((s) => s.goalRequirementLinksDraft);
  const goalsDirty = useStore((s) => s.goalsDirty);
  const selectedGoalId = useStore((s) => s.selectedGoalId);
  const rootPath = useStore((s) => s.rootPath);
  const tickets = useStore((s) => s.pmDraftTickets);
  const requirements = useStore((s) => s.requirementsDraft);
  const agents = useStore((s) => s.agents);

  const conductorRunning = useStore((s) => s.conductorRunning);
  const conductorGoalId = useStore((s) => s.conductorGoalId);
  const conductorMaxConcurrent = useStore((s) => s.conductorMaxConcurrent);
  const conductorAssignments = useStore((s) => s.conductorAssignments);
  const conductorPendingApprovals = useStore((s) => s.conductorPendingApprovals);
  const conductorDecisions = useStore((s) => s.conductorDecisions);

  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setOrchestrationOpen = useStore((s) => s.setOrchestrationOpen);
  const loadGoals = useStore((s) => s.loadGoals);
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
  const spawnNewAgent = useStore((s) => s.spawnNewAgent);

  const startConductor = useStore((s) => s.startConductor);
  const stopConductor = useStore((s) => s.stopConductor);
  const setConductorMaxConcurrent = useStore((s) => s.setConductorMaxConcurrent);
  const conductorTick = useStore((s) => s.conductorTick);
  const approveConductorTicket = useStore((s) => s.approveConductorTicket);
  const dismissConductorApproval = useStore((s) => s.dismissConductorApproval);

  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [launchingAgent, setLaunchingAgent] = useState(false);

  useEffect(() => {
    if (goalsModalOpen && rootPath) {
      loadGoals(rootPath);
      loadPmData(rootPath);
      loadRequirements(rootPath);
    }
  }, [goalsModalOpen, rootPath, loadGoals, loadPmData, loadRequirements]);

  const handleClose = useCallback(() => {
    if (goalsDirty) {
      if (!confirm('Discard unsaved changes?')) return;
      discardGoalChanges();
    }
    setGoalsModalOpen(false);
  }, [goalsDirty, discardGoalChanges, setGoalsModalOpen]);

  const handleSave = useCallback(async () => {
    if (!rootPath) return;
    await saveGoals(rootPath);
  }, [rootPath, saveGoals]);

  useEffect(() => {
    if (!goalsModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createOpen) {
        handleClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (goalsDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goalsModalOpen, createOpen, handleClose, handleSave, goalsDirty]);

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

  const pendingApprovalTickets = useMemo(
    () => tickets.filter((t) => conductorPendingApprovals.includes(t.id)),
    [tickets, conductorPendingApprovals]
  );

  const scopeGoalName = useMemo(() => {
    if (!conductorGoalId) return null;
    return goalsDraft.find((g) => g.id === conductorGoalId)?.name ?? null;
  }, [conductorGoalId, goalsDraft]);

  const handleCreate = useCallback(
    async (goal: PmGoal) => {
      addGoal(goal);
      setSelectedGoalId(goal.id);
      if (rootPath) await saveGoals(rootPath);
    },
    [addGoal, setSelectedGoalId, rootPath, saveGoals]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!confirm('Delete this goal and its entire subtree?')) return;
      deleteGoal(id);
      if (selectedGoalId === id) setSelectedGoalId(null);
    },
    [deleteGoal, selectedGoalId, setSelectedGoalId]
  );

  const handleAddSubGoal = useCallback((parentId: string) => {
    setCreateParentId(parentId);
    setCreateOpen(true);
  }, []);

  const handleLaunchAgent = useCallback(
    async (goal: PmGoal) => {
      setLaunchingAgent(true);
      try {
        await spawnNewAgent({
          name: `goal:${goal.name.slice(0, 40)}`,
          model: 'sonnet',
          task: buildGoalLaunchPrompt(goal),
          cwd: rootPath ?? undefined,
          permissionMode: 'acceptEdits',
          spawnedByGoalId: goal.id,
        });
        if (rootPath) await saveGoals(rootPath);
      } finally {
        setLaunchingAgent(false);
      }
    },
    [spawnNewAgent, rootPath, saveGoals]
  );

  const handleConductorStart = useCallback(() => {
    startConductor(selectedGoalId);
    void conductorTick();
  }, [startConductor, selectedGoalId, conductorTick]);

  if (!goalsModalOpen) return null;

  return createPortal(
    <div
      data-testid="goals-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[85vh] w-[90vw] max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-background-dark shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary-light">flag</span>
            <h1 className="text-sm font-bold text-foreground">Goals</h1>
            <span className="text-[10px] text-foreground-muted">{goalsDraft.length} total</span>
            {goalsDirty && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                unsaved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              data-testid="goals-orchestration-btn"
              onClick={() => setOrchestrationOpen(true)}
              title="Live orchestration canvas"
              className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">graph_3</span>
              Orchestration
            </button>
            <button
              data-testid="goals-create-btn"
              onClick={() => {
                setCreateParentId(null);
                setCreateOpen(true);
              }}
              className="rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
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
            <button
              data-testid="goals-close-btn"
              onClick={handleClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-[420px] flex-col border-r border-white/5">
            <GoalTree
              goals={goalsDraft}
              tickets={tickets}
              selectedId={selectedGoalId}
              onSelect={setSelectedGoalId}
              activeAgentsByGoal={activeAgentsByGoal}
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
              launchingAgent={launchingAgent}
              onUpdate={updateGoal}
              onDelete={handleDelete}
              onAchieve={achieveGoal}
              onAddSubGoal={handleAddSubGoal}
              onLaunchAgent={handleLaunchAgent}
              onLinkRequirement={linkRequirementToGoal}
              onUnlinkRequirement={unlinkRequirementFromGoal}
            />
          </div>
        </div>

        {/* Conductor */}
        <ConductorPanel
          running={conductorRunning}
          scopeGoalName={scopeGoalName}
          maxConcurrent={conductorMaxConcurrent}
          activeAgentCount={Object.keys(conductorAssignments).length}
          pendingApprovals={pendingApprovalTickets}
          decisions={conductorDecisions}
          canStart={rootPath !== null}
          onStart={handleConductorStart}
          onStop={() => stopConductor()}
          onSetMaxConcurrent={setConductorMaxConcurrent}
          onApprove={(id) => void approveConductorTicket(id)}
          onDismiss={dismissConductorApproval}
        />
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
    </div>,
    document.body
  );
}
