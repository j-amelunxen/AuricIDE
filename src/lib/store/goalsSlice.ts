import type { StateCreator } from 'zustand';
import { IDLE_LOAD_STATE, trackLoad } from './loadState';
import { withPersistFeedback } from './persistFeedback';
import type {
  GoalsState,
  GoalRunOutcome,
  PmGoal,
  PmGoalRequirementLink,
  PmGoalRun,
  PmGoalStation,
} from '../tauri/goals';
import { insertHumanStation, moveStation } from '../goals/stationOrder';
import {
  goalsLoad as ipcGoalsLoad,
  goalsSave as ipcGoalsSave,
  goalsClear as ipcGoalsClear,
} from '../tauri/goals';
import { initProjectDb } from '../tauri/db';
import type { PmTicket } from '../tauri/pm';
import {
  getRootGoals,
  getGoalChildren,
  getGoalDescendants,
  planGoalMove,
  type GoalDropPosition,
  type GoalMoveUpdate,
} from './goals/goalTreeHelpers';
import {
  getGoalProgress,
  getGoalSatisfaction,
  getGoalWorkflowStage,
  getRunsForGoal,
  nowTimestamp,
  type GoalProgress,
  type GoalSatisfaction,
  type GoalWorkflowStage,
  type GoalWorkflowStep,
} from './goals/goalSatisfaction';

export {
  getRootGoals,
  getGoalChildren,
  getGoalDescendants,
  planGoalMove,
  type GoalDropPosition,
  type GoalMoveUpdate,
  getGoalProgress,
  getGoalSatisfaction,
  getGoalWorkflowStage,
  getRunsForGoal,
  type GoalProgress,
  type GoalSatisfaction,
  type GoalWorkflowStage,
  type GoalWorkflowStep,
};

// saveGoals is a read-modify-write with awaits in the middle. Serialize
// invocations so an overlapping save (heartbeat tick + agent-status tick)
// can never interleave its re-load with another save's sync.
let goalsSaveChain: Promise<void> = Promise.resolve();

export interface GoalsSlice {
  /** True while project data is being read; distinguishes empty from not-yet. */
  goalsLoading: boolean;
  /** Why the last load failed; null when it succeeded or never ran. */
  goalsLoadError: string | null;
  // Persisted state (last saved)
  goals: PmGoal[];
  goalRuns: PmGoalRun[];
  goalRequirementLinks: PmGoalRequirementLink[];
  goalStations: PmGoalStation[];
  // Draft state (local edits before save)
  goalsDraft: PmGoal[];
  goalRunsDraft: PmGoalRun[];
  goalRequirementLinksDraft: PmGoalRequirementLink[];
  goalStationsDraft: PmGoalStation[];
  goalsDirty: boolean;
  currentGoalsProject: string | null;
  // UI state
  goalsModalOpen: boolean;
  selectedGoalId: string | null;
  orchestrationOpen: boolean;
  goalLinesOpen: boolean;
  /** True only when Goal Lines replaced Goals — Esc should then reopen Goals. */
  goalLinesReturnToGoals: boolean;
  // Actions
  loadGoals: (projectPath: string) => Promise<void>;
  saveGoals: (projectPath: string) => Promise<void>;
  clearGoals: (projectPath: string) => Promise<void>;
  resetGoalsInMemory: () => void;
  addGoal: (goal: PmGoal) => void;
  updateGoal: (id: string, updates: Partial<PmGoal>) => void;
  deleteGoal: (id: string) => void;
  achieveGoal: (id: string) => void;
  linkRequirementToGoal: (goalId: string, requirementId: string) => void;
  unlinkRequirementFromGoal: (goalId: string, requirementId: string) => void;
  recordGoalRun: (run: PmGoalRun) => void;
  completeGoalRun: (runId: string, outcome: GoalRunOutcome, summary?: string) => void;
  addStation: (station: PmGoalStation) => void;
  updateStation: (id: string, updates: Partial<PmGoalStation>) => void;
  deleteStation: (id: string) => void;
  /** Removes a committed line without deleting its goal or descendant lines. */
  resetGoalLine: (goalId: string) => void;
  /** A person ticks a human step off — the one evidence only they can give. */
  tickHumanStation: (id: string, note?: string) => void;
  moveStationTo: (goalId: string, stationId: string, toIndex: number) => void;
  quickAddHumanStation: (goalId: string, name: string) => void;
  discardGoalChanges: () => void;
  setGoalsModalOpen: (open: boolean) => void;
  setSelectedGoalId: (id: string | null) => void;
  setOrchestrationOpen: (open: boolean) => void;
  setGoalLinesOpen: (open: boolean, opts?: { fromGoals?: boolean }) => void;
}

/**
 * Drop the goal link from every ticket that pointed at one of the deleted
 * goals (cross-slice, optional — the goals slice runs without PM in tests).
 * Tickets carry the link on their own side and save through `savePmData`, so a
 * ticket left pointing at a deleted goal would keep claiming that link while
 * dropping out of the subtree walk `getGoalSatisfaction` does. `updateTicket`
 * owns the PM dirty flag, so routing through it keeps the change persistable.
 */
function clearGoalLinkOnTickets(state: GoalsSlice, deletedGoalIds: Set<string>): void {
  const pm = state as GoalsSlice & {
    pmDraftTickets?: PmTicket[];
    updateTicket?: (id: string, updates: Partial<PmTicket>) => void;
  };
  if (!pm.pmDraftTickets || !pm.updateTicket) return;
  for (const ticket of pm.pmDraftTickets) {
    if (ticket.goalId && deletedGoalIds.has(ticket.goalId)) {
      pm.updateTicket(ticket.id, { goalId: null });
    }
  }
}

export const createGoalsSlice: StateCreator<GoalsSlice> = (set, get) => ({
  goals: [],
  goalsLoading: IDLE_LOAD_STATE.loading,
  goalsLoadError: IDLE_LOAD_STATE.error,
  goalRuns: [],
  goalRequirementLinks: [],
  goalStations: [],
  goalsDraft: [],
  goalRunsDraft: [],
  goalRequirementLinksDraft: [],
  goalStationsDraft: [],
  goalsDirty: false,
  currentGoalsProject: null,
  goalsModalOpen: false,
  selectedGoalId: null,
  orchestrationOpen: false,
  goalLinesOpen: false,
  goalLinesReturnToGoals: false,

  loadGoals: (projectPath) =>
    trackLoad(
      (s) => set({ goalsLoading: s.loading, goalsLoadError: s.error }),
      async () => {
        await initProjectDb(projectPath);
        const state: GoalsState = await ipcGoalsLoad(projectPath);
        const { goalsDirty, currentGoalsProject } = get();
        const isNewProject = currentGoalsProject !== projectPath;

        if (!goalsDirty || isNewProject) {
          set({
            goals: state.goals,
            goalsDraft: state.goals,
            goalRuns: state.goalRuns,
            goalRunsDraft: state.goalRuns,
            goalRequirementLinks: state.requirementLinks,
            goalRequirementLinksDraft: state.requirementLinks,
            goalStations: state.stations,
            goalStationsDraft: state.stations,
            goalsDirty: false,
            currentGoalsProject: projectPath,
          });
        } else {
          // Dirty draft: keep local edits, but adopt rows created since the last
          // load (e.g. goals an MCP agent decomposed) so they are not invisible.
          const {
            goals,
            goalsDraft,
            goalRuns,
            goalRunsDraft,
            goalRequirementLinksDraft,
            goalStations,
            goalStationsDraft,
          } = get();
          const knownGoalIds = new Set([...goals, ...goalsDraft].map((g) => g.id));
          const knownRunIds = new Set([...goalRuns, ...goalRunsDraft].map((r) => r.id));
          const knownLinkIds = new Set(
            [...get().goalRequirementLinks, ...goalRequirementLinksDraft].map((l) => l.id)
          );
          const knownStationIds = new Set([...goalStations, ...goalStationsDraft].map((s) => s.id));
          set({
            goals: state.goals,
            goalRuns: state.goalRuns,
            goalRequirementLinks: state.requirementLinks,
            goalStations: state.stations,
            goalsDraft: [...goalsDraft, ...state.goals.filter((g) => !knownGoalIds.has(g.id))],
            goalRunsDraft: [
              ...goalRunsDraft,
              ...state.goalRuns.filter((r) => !knownRunIds.has(r.id)),
            ],
            goalRequirementLinksDraft: [
              ...goalRequirementLinksDraft,
              ...state.requirementLinks.filter((l) => !knownLinkIds.has(l.id)),
            ],
            goalStationsDraft: [
              ...goalStationsDraft,
              ...state.stations.filter((s) => !knownStationIds.has(s.id)),
            ],
            currentGoalsProject: projectPath,
          });
        }
      }
    ),

  saveGoals: (projectPath) => {
    const doSave = async (): Promise<void> => {
      await initProjectDb(projectPath);
      const {
        goals,
        goalRuns,
        goalRequirementLinks,
        goalStations,
        goalsDraft,
        goalRunsDraft,
        goalRequirementLinksDraft,
        goalStationsDraft,
      } = get();

      // Row-level sync: upsert the draft, delete only what the user deleted
      // locally (present in the persisted baseline but gone from the draft).
      const draftGoalIds = new Set(goalsDraft.map((g) => g.id));
      const draftRunIds = new Set(goalRunsDraft.map((r) => r.id));
      const draftLinkIds = new Set(goalRequirementLinksDraft.map((l) => l.id));
      const draftStationIds = new Set(goalStationsDraft.map((s) => s.id));
      await ipcGoalsSave(projectPath, {
        goals: goalsDraft,
        goalRuns: goalRunsDraft,
        requirementLinks: goalRequirementLinksDraft,
        stations: goalStationsDraft,
        deletedGoalIds: goals.filter((g) => !draftGoalIds.has(g.id)).map((g) => g.id),
        deletedRunIds: goalRuns.filter((r) => !draftRunIds.has(r.id)).map((r) => r.id),
        deletedLinkIds: goalRequirementLinks
          .filter((l) => !draftLinkIds.has(l.id))
          .map((l) => l.id),
        deletedStationIds: goalStations.filter((s) => !draftStationIds.has(s.id)).map((s) => s.id),
      });

      // Re-read and adopt rows MCP agents wrote concurrently. The draft was
      // just persisted, so anything unknown in the DB is a concurrent write.
      const loaded = await ipcGoalsLoad(projectPath);
      const mergedGoals = [...goalsDraft, ...loaded.goals.filter((g) => !draftGoalIds.has(g.id))];
      const mergedRuns = [
        ...goalRunsDraft,
        ...loaded.goalRuns.filter((r) => !draftRunIds.has(r.id)),
      ];
      const mergedLinks = [
        ...goalRequirementLinksDraft,
        ...loaded.requirementLinks.filter((l) => !draftLinkIds.has(l.id)),
      ];
      const mergedStations = [
        ...goalStationsDraft,
        ...loaded.stations.filter((s) => !draftStationIds.has(s.id)),
      ];
      set({
        goals: mergedGoals,
        goalsDraft: mergedGoals,
        goalRuns: mergedRuns,
        goalRunsDraft: mergedRuns,
        goalRequirementLinks: mergedLinks,
        goalRequirementLinksDraft: mergedLinks,
        goalStations: mergedStations,
        goalStationsDraft: mergedStations,
        goalsDirty: false,
      });
    };

    const next = goalsSaveChain.then(
      () => withPersistFeedback(get(), 'goals', doSave),
      () => withPersistFeedback(get(), 'goals', doSave)
    );
    goalsSaveChain = next.catch(() => {
      // A failed save must not poison the queue for subsequent saves
    });
    return next;
  },

  clearGoals: async (projectPath) => {
    await initProjectDb(projectPath);
    await ipcGoalsClear(projectPath);
    set({
      goals: [],
      goalsDraft: [],
      goalRuns: [],
      goalRunsDraft: [],
      goalRequirementLinks: [],
      goalRequirementLinksDraft: [],
      goalStations: [],
      goalStationsDraft: [],
      goalsDirty: false,
    });
  },

  resetGoalsInMemory: () =>
    set({
      goals: [],
      goalsDraft: [],
      goalRuns: [],
      goalRunsDraft: [],
      goalRequirementLinks: [],
      goalRequirementLinksDraft: [],
      goalStations: [],
      goalStationsDraft: [],
      goalsDirty: false,
    }),

  addGoal: (goal) => set((s) => ({ goalsDraft: [...s.goalsDraft, goal], goalsDirty: true })),

  updateGoal: (id, updates) =>
    set((s) => ({
      goalsDraft: s.goalsDraft.map((g) =>
        g.id === id ? { ...g, ...updates, updatedAt: nowTimestamp() } : g
      ),
      goalsDirty: true,
    })),

  deleteGoal: (id) => {
    const { goalsDraft } = get();
    const doomed = new Set<string>([id, ...getGoalDescendants(goalsDraft, id).map((g) => g.id)]);
    set((s) => ({
      goalsDraft: s.goalsDraft.filter((g) => !doomed.has(g.id)),
      goalRunsDraft: s.goalRunsDraft.filter((r) => !doomed.has(r.goalId)),
      goalRequirementLinksDraft: s.goalRequirementLinksDraft.filter((l) => !doomed.has(l.goalId)),
      goalStationsDraft: s.goalStationsDraft.filter((st) => !doomed.has(st.goalId)),
      goalsDirty: true,
    }));
    clearGoalLinkOnTickets(get(), doomed);
  },

  achieveGoal: (id) => {
    const achievedAt = nowTimestamp();
    set((s) => ({
      goalsDraft: s.goalsDraft.map((g) =>
        g.id === id ? { ...g, status: 'achieved', achievedAt, updatedAt: achievedAt } : g
      ),
      goalsDirty: true,
    }));
  },

  linkRequirementToGoal: (goalId, requirementId) => {
    const { goalRequirementLinksDraft } = get();
    const exists = goalRequirementLinksDraft.some(
      (l) => l.goalId === goalId && l.requirementId === requirementId
    );
    if (exists) return;
    set((s) => ({
      goalRequirementLinksDraft: [
        ...s.goalRequirementLinksDraft,
        { id: crypto.randomUUID(), goalId, requirementId, createdAt: nowTimestamp() },
      ],
      goalsDirty: true,
    }));
  },

  unlinkRequirementFromGoal: (goalId, requirementId) =>
    set((s) => ({
      goalRequirementLinksDraft: s.goalRequirementLinksDraft.filter(
        (l) => !(l.goalId === goalId && l.requirementId === requirementId)
      ),
      goalsDirty: true,
    })),

  recordGoalRun: (run) =>
    set((s) => ({
      goalRunsDraft: [...s.goalRunsDraft, run],
      // Launching work on a goal moves it into in_progress
      goalsDraft: s.goalsDraft.map((g) =>
        g.id === run.goalId && (g.status === 'draft' || g.status === 'active')
          ? { ...g, status: 'in_progress', updatedAt: nowTimestamp() }
          : g
      ),
      goalsDirty: true,
    })),

  completeGoalRun: (runId, outcome, summary) =>
    set((s) => ({
      goalRunsDraft: s.goalRunsDraft.map((r) =>
        r.id === runId
          ? { ...r, outcome, summary: summary ?? r.summary, finishedAt: nowTimestamp() }
          : r
      ),
      goalsDirty: true,
    })),

  discardGoalChanges: () => {
    const { goals, goalRuns, goalRequirementLinks, goalStations } = get();
    set({
      goalsDraft: goals,
      goalRunsDraft: goalRuns,
      goalRequirementLinksDraft: goalRequirementLinks,
      goalStationsDraft: goalStations,
      goalsDirty: false,
    });
  },

  addStation: (station) =>
    set((s) => ({
      goalStationsDraft: [...s.goalStationsDraft, station],
      goalsDirty: true,
    })),

  updateStation: (id, updates) =>
    set((s) => ({
      goalStationsDraft: s.goalStationsDraft.map((st) =>
        st.id === id ? { ...st, ...updates, updatedAt: nowTimestamp() } : st
      ),
      goalsDirty: true,
    })),

  deleteStation: (id) =>
    set((s) => ({
      goalStationsDraft: s.goalStationsDraft.filter((st) => st.id !== id),
      goalsDirty: true,
    })),

  resetGoalLine: (goalId) => {
    const ts = nowTimestamp();
    set((s) => ({
      goalStationsDraft: s.goalStationsDraft.filter((station) => station.goalId !== goalId),
      goalsDraft: s.goalsDraft.map((goal) =>
        goal.id === goalId && goal.status !== 'archived' && goal.status !== 'achieved'
          ? { ...goal, status: 'draft', achievedAt: null, updatedAt: ts }
          : goal
      ),
      goalsDirty: true,
    }));
  },

  tickHumanStation: (id, note) => {
    const ts = nowTimestamp();
    set((s) => ({
      goalStationsDraft: s.goalStationsDraft.map((st) =>
        st.id === id
          ? {
              ...st,
              status: 'done',
              evidenceKind: 'human',
              evidenceNote: note ?? 'ticked off by you',
              doneAt: ts,
              updatedAt: ts,
            }
          : st
      ),
      goalsDirty: true,
    }));
  },

  moveStationTo: (goalId, stationId, toIndex) =>
    set((s) => ({
      goalStationsDraft: moveStation(s.goalStationsDraft, goalId, stationId, toIndex),
      goalsDirty: true,
    })),

  quickAddHumanStation: (goalId, name) =>
    set((s) => ({
      goalStationsDraft: insertHumanStation(
        s.goalStationsDraft,
        goalId,
        name,
        crypto.randomUUID(),
        nowTimestamp()
      ),
      goalsDirty: true,
    })),

  setGoalsModalOpen: (open) => set({ goalsModalOpen: open }),
  setSelectedGoalId: (id) => set({ selectedGoalId: id }),
  setOrchestrationOpen: (open) => set({ orchestrationOpen: open }),
  setGoalLinesOpen: (open, opts) =>
    set({
      goalLinesOpen: open,
      goalLinesReturnToGoals: open ? Boolean(opts?.fromGoals) : false,
    }),
});
