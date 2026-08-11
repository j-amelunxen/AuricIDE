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
import { isVerifiedEvidence } from '../pm/enums';
import {
  goalsLoad as ipcGoalsLoad,
  goalsSave as ipcGoalsSave,
  goalsClear as ipcGoalsClear,
} from '../tauri/goals';
import { initProjectDb } from '../tauri/db';
import type { PmTicket } from '../tauri/pm';
import type { PmRequirement } from '../tauri/requirements';

// --- Pure tree helpers ---

export function getRootGoals(goals: PmGoal[]): PmGoal[] {
  return goals
    .filter((g) => g.parentId === null || g.parentId === undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function getGoalChildren(goals: PmGoal[], parentId: string): PmGoal[] {
  return goals
    .filter((g) => g.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function getGoalDescendants(goals: PmGoal[], goalId: string): PmGoal[] {
  const result: PmGoal[] = [];
  const visited = new Set<string>([goalId]);
  let frontier = [goalId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of getGoalChildren(goals, id)) {
        if (visited.has(child.id)) continue; // guards against corrupted cyclic data
        visited.add(child.id);
        result.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return result;
}

export type GoalDropPosition = 'before' | 'inside' | 'after';

export interface GoalMoveUpdate {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/** Plans a tree move while preserving dense sibling ordering and preventing cycles. */
export function planGoalMove(
  goals: PmGoal[],
  draggedId: string,
  targetId: string,
  position: GoalDropPosition
): GoalMoveUpdate[] {
  const dragged = goals.find((goal) => goal.id === draggedId);
  const target = goals.find((goal) => goal.id === targetId);
  if (!dragged || !target || draggedId === targetId) return [];

  const descendants = new Set(getGoalDescendants(goals, draggedId).map((goal) => goal.id));
  if (descendants.has(targetId)) return [];

  const oldParentId = dragged.parentId ?? null;
  const newParentId = position === 'inside' ? target.id : (target.parentId ?? null);
  const newSiblings = goals
    .filter((goal) => (goal.parentId ?? null) === newParentId && goal.id !== draggedId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  const insertionIndex =
    position === 'inside'
      ? newSiblings.length
      : Math.max(
          0,
          newSiblings.findIndex((goal) => goal.id === targetId)
        ) + (position === 'after' ? 1 : 0);
  newSiblings.splice(insertionIndex, 0, dragged);

  const updates = new Map<string, GoalMoveUpdate>();
  newSiblings.forEach((goal, sortOrder) => {
    updates.set(goal.id, { id: goal.id, parentId: newParentId, sortOrder });
  });

  if (oldParentId !== newParentId) {
    goals
      .filter((goal) => (goal.parentId ?? null) === oldParentId && goal.id !== draggedId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
      .forEach((goal, sortOrder) => {
        updates.set(goal.id, { id: goal.id, parentId: oldParentId, sortOrder });
      });
  }

  return [...updates.values()].filter((update) => {
    const original = goals.find((goal) => goal.id === update.id);
    return (
      original &&
      ((original.parentId ?? null) !== update.parentId || original.sortOrder !== update.sortOrder)
    );
  });
}

export interface GoalProgress {
  totalTickets: number;
  doneTickets: number;
}

/** Ticket progress across the goal itself plus all of its descendants. */
export function getGoalProgress(
  goals: PmGoal[],
  tickets: PmTicket[],
  goalId: string
): GoalProgress {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  const scoped = tickets.filter((t) => !!t.goalId && ids.has(t.goalId));
  return {
    totalTickets: scoped.length,
    doneTickets: scoped.filter((t) => t.status === 'done').length,
  };
}

export interface GoalSatisfaction {
  satisfied: boolean;
  /** Human-readable reasons the goal is not yet satisfied. Empty when satisfied. */
  blockers: string[];
}

/**
 * A goal is satisfied when every ticket attached to it (and its subtree) is
 * done, every linked requirement is verified, every station of its line is
 * done, and every direct child goal is achieved. This is the
 * machine-checkable core of "goal = desired world state".
 *
 * The `stations` parameter is REQUIRED on purpose: an open human station
 * ("call the customer") that satisfaction cannot see would let the conductor
 * auto-achieve a goal right past it. A silent default would compile at
 * exactly the call site someone forgot. This function has an SQL twin in
 * src/mcp/tools/goals.ts (evaluateGoal) — change both together.
 */
export function getGoalSatisfaction(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
  stations: PmGoalStation[],
  goalId: string
): GoalSatisfaction {
  const blockers: string[] = [];
  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);

  const scopedTickets = tickets.filter((t) => !!t.goalId && subtreeIds.has(t.goalId));
  for (const ticket of scopedTickets) {
    if (ticket.status !== 'done') {
      blockers.push(`Ticket "${ticket.name}" is ${ticket.status}`);
    }
  }

  const linkedReqIds = new Set(
    links.filter((l) => l.goalId === goalId).map((l) => l.requirementId)
  );
  for (const req of requirements) {
    if (linkedReqIds.has(req.id) && req.status !== 'verified') {
      blockers.push(`Requirement ${req.reqId} is ${req.status}, not verified`);
    }
  }

  const scopedStations = stations.filter((s) => subtreeIds.has(s.goalId));
  for (const station of scopedStations) {
    if (station.status !== 'done') {
      blockers.push(`Station "${station.name}" is ${station.status}`);
    } else if (!isVerifiedEvidence(station.evidenceKind)) {
      // Done, but only claimed — the judge (or a person) has to verify it
      // before it counts. A bare claim blocks exactly like a pending station.
      blockers.push(`Station "${station.name}": unverified claim`);
    }
  }

  const children = getGoalChildren(goals, goalId);
  for (const child of children) {
    if (child.status !== 'achieved') {
      blockers.push(`Sub-goal "${child.name}" is ${child.status}, not achieved`);
    }
  }

  // A goal with nothing attached is vacuously "true" but not meaningfully
  // achieved — refuse to auto-satisfy it.
  if (
    scopedTickets.length === 0 &&
    linkedReqIds.size === 0 &&
    children.length === 0 &&
    scopedStations.length === 0
  ) {
    blockers.push(
      'This goal has no attached tickets, linked requirements, child goals, or goal-line stations. Add work before running the conductor.'
    );
  }

  return { satisfied: blockers.length === 0, blockers };
}

export type GoalWorkflowStage = 'define' | 'attach' | 'execute' | 'done';

export interface GoalWorkflowStep {
  stage: GoalWorkflowStage;
  /** 1-based position in the define → attach → execute → done loop. */
  index: 1 | 2 | 3 | 4;
  /** The one concrete next action that moves the goal forward. */
  hint: string;
}

/**
 * Where a goal stands in the workflow loop. Drives the onboarding stepper:
 * each stage names exactly one next action instead of explaining everything.
 */
export function getGoalWorkflowStage(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
  stations: PmGoalStation[],
  goalId: string
): GoalWorkflowStep {
  const goal = goals.find((g) => g.id === goalId);
  const satisfaction = getGoalSatisfaction(goals, tickets, requirements, links, stations, goalId);

  if (goal?.status === 'achieved' || satisfaction.satisfied) {
    return {
      stage: 'done',
      index: 4,
      hint:
        goal?.status === 'achieved'
          ? 'Goal achieved.'
          : 'Checks green: mark achieved or run conductor.',
    };
  }

  if (!goal?.successCriteria.trim()) {
    return {
      stage: 'define',
      index: 1,
      hint: 'Add success criteria.',
    };
  }

  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);
  const hasTickets = tickets.some((t) => !!t.goalId && subtreeIds.has(t.goalId));
  const hasLinks = links.some((l) => l.goalId === goalId);
  const hasChildren = getGoalChildren(goals, goalId).length > 0;
  const hasStations = stations.some((s) => subtreeIds.has(s.goalId));

  if (!hasTickets && !hasLinks && !hasChildren && !hasStations) {
    return {
      stage: 'attach',
      index: 2,
      hint: 'Link tickets or run a planning agent.',
    };
  }

  return {
    stage: 'execute',
    index: 3,
    hint: 'Start the conductor to work open tickets.',
  };
}

export function getRunsForGoal(runs: PmGoalRun[], goalId: string): PmGoalRun[] {
  return runs
    .filter((r) => r.goalId === goalId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

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
  setGoalLinesOpen: (open: boolean) => void;
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
  setGoalLinesOpen: (open) => set({ goalLinesOpen: open }),
});
