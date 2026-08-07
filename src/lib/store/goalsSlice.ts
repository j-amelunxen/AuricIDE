import type { StateCreator } from 'zustand';
import { IDLE_LOAD_STATE, trackLoad } from './loadState';
import { withPersistFeedback } from './persistFeedback';
import type {
  GoalsState,
  GoalRunOutcome,
  PmGoal,
  PmGoalRequirementLink,
  PmGoalRun,
} from '../tauri/goals';
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
  return goals.filter((g) => g.parentId === null || g.parentId === undefined);
}

export function getGoalChildren(goals: PmGoal[], parentId: string): PmGoal[] {
  return goals.filter((g) => g.parentId === parentId);
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
 * done, every linked requirement is verified, and every direct child goal is
 * achieved. This is the machine-checkable core of "goal = desired world state".
 */
export function getGoalSatisfaction(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
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

  const children = getGoalChildren(goals, goalId);
  for (const child of children) {
    if (child.status !== 'achieved') {
      blockers.push(`Sub-goal "${child.name}" is ${child.status}, not achieved`);
    }
  }

  // A goal with nothing attached is vacuously "true" but not meaningfully
  // achieved — refuse to auto-satisfy it.
  if (scopedTickets.length === 0 && linkedReqIds.size === 0 && children.length === 0) {
    blockers.push('Goal has no tickets, requirements, or sub-goals — nothing to verify');
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
  goalId: string
): GoalWorkflowStep {
  const goal = goals.find((g) => g.id === goalId);
  const satisfaction = getGoalSatisfaction(goals, tickets, requirements, links, goalId);

  if (goal?.status === 'achieved' || satisfaction.satisfied) {
    return {
      stage: 'done',
      index: 4,
      hint:
        goal?.status === 'achieved'
          ? 'Goal achieved.'
          : 'All checks green: mark achieved, or let the conductor do it.',
    };
  }

  if (!goal?.successCriteria.trim()) {
    return {
      stage: 'define',
      index: 1,
      hint: 'Write success criteria so this goal becomes machine-checkable.',
    };
  }

  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);
  const hasTickets = tickets.some((t) => !!t.goalId && subtreeIds.has(t.goalId));
  const hasLinks = links.some((l) => l.goalId === goalId);
  const hasChildren = getGoalChildren(goals, goalId).length > 0;

  if (!hasTickets && !hasLinks && !hasChildren) {
    return {
      stage: 'attach',
      index: 2,
      hint: 'Attach work: link tickets, or launch a planning agent to decompose this goal.',
    };
  }

  return {
    stage: 'execute',
    index: 3,
    hint: 'Start the conductor: it works the open tickets and verifies the goal.',
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
  // Draft state (local edits before save)
  goalsDraft: PmGoal[];
  goalRunsDraft: PmGoalRun[];
  goalRequirementLinksDraft: PmGoalRequirementLink[];
  goalsDirty: boolean;
  currentGoalsProject: string | null;
  // UI state
  goalsModalOpen: boolean;
  selectedGoalId: string | null;
  orchestrationOpen: boolean;
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
  discardGoalChanges: () => void;
  setGoalsModalOpen: (open: boolean) => void;
  setSelectedGoalId: (id: string | null) => void;
  setOrchestrationOpen: (open: boolean) => void;
}

export const createGoalsSlice: StateCreator<GoalsSlice> = (set, get) => ({
  goals: [],
  goalsLoading: IDLE_LOAD_STATE.loading,
  goalsLoadError: IDLE_LOAD_STATE.error,
  goalRuns: [],
  goalRequirementLinks: [],
  goalsDraft: [],
  goalRunsDraft: [],
  goalRequirementLinksDraft: [],
  goalsDirty: false,
  currentGoalsProject: null,
  goalsModalOpen: false,
  selectedGoalId: null,
  orchestrationOpen: false,

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
            goalsDirty: false,
            currentGoalsProject: projectPath,
          });
        } else {
          // Dirty draft: keep local edits, but adopt rows created since the last
          // load (e.g. goals an MCP agent decomposed) so they are not invisible.
          const { goals, goalsDraft, goalRuns, goalRunsDraft, goalRequirementLinksDraft } = get();
          const knownGoalIds = new Set([...goals, ...goalsDraft].map((g) => g.id));
          const knownRunIds = new Set([...goalRuns, ...goalRunsDraft].map((r) => r.id));
          const knownLinkIds = new Set(
            [...get().goalRequirementLinks, ...goalRequirementLinksDraft].map((l) => l.id)
          );
          set({
            goals: state.goals,
            goalRuns: state.goalRuns,
            goalRequirementLinks: state.requirementLinks,
            goalsDraft: [...goalsDraft, ...state.goals.filter((g) => !knownGoalIds.has(g.id))],
            goalRunsDraft: [
              ...goalRunsDraft,
              ...state.goalRuns.filter((r) => !knownRunIds.has(r.id)),
            ],
            goalRequirementLinksDraft: [
              ...goalRequirementLinksDraft,
              ...state.requirementLinks.filter((l) => !knownLinkIds.has(l.id)),
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
        goalsDraft,
        goalRunsDraft,
        goalRequirementLinksDraft,
      } = get();

      // Row-level sync: upsert the draft, delete only what the user deleted
      // locally (present in the persisted baseline but gone from the draft).
      const draftGoalIds = new Set(goalsDraft.map((g) => g.id));
      const draftRunIds = new Set(goalRunsDraft.map((r) => r.id));
      const draftLinkIds = new Set(goalRequirementLinksDraft.map((l) => l.id));
      await ipcGoalsSave(projectPath, {
        goals: goalsDraft,
        goalRuns: goalRunsDraft,
        requirementLinks: goalRequirementLinksDraft,
        deletedGoalIds: goals.filter((g) => !draftGoalIds.has(g.id)).map((g) => g.id),
        deletedRunIds: goalRuns.filter((r) => !draftRunIds.has(r.id)).map((r) => r.id),
        deletedLinkIds: goalRequirementLinks
          .filter((l) => !draftLinkIds.has(l.id))
          .map((l) => l.id),
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
      set({
        goals: mergedGoals,
        goalsDraft: mergedGoals,
        goalRuns: mergedRuns,
        goalRunsDraft: mergedRuns,
        goalRequirementLinks: mergedLinks,
        goalRequirementLinksDraft: mergedLinks,
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
    const { goals, goalRuns, goalRequirementLinks } = get();
    set({
      goalsDraft: goals,
      goalRunsDraft: goalRuns,
      goalRequirementLinksDraft: goalRequirementLinks,
      goalsDirty: false,
    });
  },

  setGoalsModalOpen: (open) => set({ goalsModalOpen: open }),
  setSelectedGoalId: (id) => set({ selectedGoalId: id }),
  setOrchestrationOpen: (open) => set({ orchestrationOpen: open }),
});
