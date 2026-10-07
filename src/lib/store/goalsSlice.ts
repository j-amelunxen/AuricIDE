import type { StateCreator } from 'zustand';
import { IDLE_LOAD_STATE, trackLoad } from './loadState';
import { writeChanged } from './stableRefs';
import { withPersistFeedback } from './persistFeedback';
import type {
  GoalsState,
  GoalRunOutcome,
  GoalsSyncResult,
  PmGoal,
  PmGoalDependency,
  PmGoalRequirementLink,
  PmGoalRun,
  PmGoalStation,
} from '../tauri/goals';
import { normalizeBundle, type GoalDependencyError } from '../goals/goalDependencies';
import { getIntroducedDependencyErrors, toDependencyEdges } from './goals/goalDependencyAdapters';
import { dropIntroducedDependencyDrafts } from './goals/goalDependencyRebase';
import { editedRows, findClashes, rebaseDraft } from '../goals/draftMerge';
import {
  mergeConflicts,
  pinClashes,
  withPinnedBases,
  type GoalConflict,
  type GoalConflictChoice,
  type GoalConflictTable,
} from '../goals/goalConflicts';
import type { ToastSlice } from './toastSlice';
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
  getGoalCompletion,
  getGoalSatisfaction,
  getGoalStationProgress,
  getGoalWorkMode,
  getGoalWorkflowStage,
  getGoalWorkProgress,
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
  getGoalCompletion,
  getGoalSatisfaction,
  getGoalStationProgress,
  getGoalWorkMode,
  getGoalWorkflowStage,
  getGoalWorkProgress,
  getRunsForGoal,
  type GoalProgress,
  type GoalSatisfaction,
  type GoalWorkflowStage,
  type GoalWorkflowStep,
};
export { getGoalBlockers, getSiblingWaves } from './goals/goalDependencyAdapters';

/** What `addGoalDependency`/`setGoalBundle` hand back so the UI can toast the reason. */
export type GoalDependencyResult = { ok: true } | { ok: false; error: GoalDependencyError };

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
  goalDependencies: PmGoalDependency[];
  // Draft state (local edits before save)
  goalsDraft: PmGoal[];
  goalRunsDraft: PmGoalRun[];
  goalRequirementLinksDraft: PmGoalRequirementLink[];
  goalStationsDraft: PmGoalStation[];
  goalDependenciesDraft: PmGoalDependency[];
  goalsDirty: boolean;
  /**
   * Rows the person and an agent changed at the same time. The database keeps
   * the agent's value, the draft keeps the person's, until the person decides.
   */
  goalConflicts: GoalConflict[];
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
  /**
   * Adds `goalId -> dependsOnGoalId`, validated against the current draft
   * goals and edges (`validateGoalDependencies`). Rejects with the error
   * instead of adding a row the goal tree would then have to reject on save.
   */
  addGoalDependency: (goalId: string, dependsOnGoalId: string) => GoalDependencyResult;
  removeGoalDependency: (goalId: string, dependsOnGoalId: string) => void;
  /**
   * Sets or clears the goal's bundle label, validated the same way: a bundle
   * change can turn an existing edge into a same-bundle or cycle violation,
   * so the whole edge set is re-checked before the label is applied.
   */
  setGoalBundle: (goalId: string, bundle: string | null) => GoalDependencyResult;
  recordGoalRun: (run: PmGoalRun) => void;
  completeGoalRun: (runId: string, outcome: GoalRunOutcome, summary?: string) => void;
  /**
   * Writes one run row to the project db right away, without the rest of the
   * draft: a goal-bound start from an agent's launch request must survive a
   * restart, and must not overwrite goals MCP agents changed meanwhile.
   */
  persistGoalRun: (projectPath: string, runId: string) => Promise<void>;
  addStation: (station: PmGoalStation) => void;
  updateStation: (id: string, updates: Partial<PmGoalStation>) => void;
  deleteStation: (id: string) => void;
  /** Removes a committed line without deleting its goal or descendant lines. */
  resetGoalLine: (goalId: string) => void;
  /** A person ticks a human step off — the one evidence only they can give. */
  tickHumanStation: (id: string, note?: string) => void;
  /**
   * A person decides a station is not needed, and says why. Same rules as MCP
   * skip_station: a reason is required, and gates, human steps and done work
   * cannot be skipped. Refused calls change nothing.
   */
  skipStation: (id: string, reason: string) => void;
  moveStationTo: (goalId: string, stationId: string, toIndex: number) => void;
  quickAddHumanStation: (goalId: string, name: string) => void;
  discardGoalChanges: () => void;
  /** 'mine' keeps the draft value for the next save, 'theirs' takes the database's. */
  resolveGoalConflict: (table: GoalConflictTable, id: string, choice: GoalConflictChoice) => void;
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

/** The persisted rows as the person's edits see them: conflicted rows pinned. */
function pinnedBases(state: GoalsSlice) {
  return {
    goals: withPinnedBases(state.goals, state.goalConflicts, 'pm_goals'),
    goalRuns: withPinnedBases(state.goalRuns, state.goalConflicts, 'pm_goal_runs'),
    goalStations: withPinnedBases(state.goalStations, state.goalConflicts, 'pm_goal_stations'),
  };
}

/**
 * The way out of a stuck dependency draft: after any rebase against a fresh
 * load, drop the local edge or bundle edit that a concurrent write elsewhere
 * made invalid (`dropIntroducedDependencyDrafts`), and say so — otherwise a
 * save that keeps re-sending the same now-bad edit would keep failing
 * forever. Returns the goals/edges to actually use as the draft.
 */
function guardDependencyDraft(
  state: GoalsSlice,
  fresh: { goals: PmGoal[]; edges: PmGoalDependency[] },
  rebasedGoals: PmGoal[],
  rebasedEdges: PmGoalDependency[]
): { goals: PmGoal[]; edges: PmGoalDependency[] } {
  const repair = dropIntroducedDependencyDrafts(fresh, {
    goals: rebasedGoals,
    edges: rebasedEdges,
  });
  if (repair.droppedEdgeIds.length > 0 || repair.resetBundleGoalIds.length > 0) {
    (state as Partial<ToastSlice>).showToast?.(
      'A goal dependency change conflicted with one written elsewhere and was reverted.',
      'error'
    );
  }
  return { goals: repair.goals, edges: repair.edges };
}

/**
 * Runs a goals_save attempt, and on a rejected dependency edge recovers
 * instead of leaving the draft stuck: the whole write rolled back (contract:
 * any dependency violation fails the transaction), so a plain retry would
 * resend the same now-bad edge forever. Reloading runs the dependency-draft
 * guard (see `loadGoals`'s dirty branch), which drops the offending local
 * edit or bundle edit before the next attempt is made. The original error
 * still propagates — this recovers state, it does not swallow the failure.
 */
async function saveGoalsRecoveringDependencyDraft(
  projectPath: string,
  loadGoals: (projectPath: string) => Promise<void>,
  attempt: () => Promise<GoalsSyncResult>
): Promise<GoalsSyncResult> {
  try {
    return await attempt();
  } catch (error) {
    if (String(error).includes('Goal dependency rejected')) {
      await loadGoals(projectPath);
    }
    throw error;
  }
}

/**
 * Folds `found` into the known conflicts against the freshly loaded rows and
 * says so once per newly conflicted row. The toast is the only interruption:
 * a clash means an agent and the person disagree, which the person must see.
 */
function noteConflicts(
  state: GoalsSlice,
  found: GoalConflict[],
  fresh: { goals: PmGoal[]; goalRuns: PmGoalRun[]; stations: PmGoalStation[] }
): GoalConflict[] {
  const rows: Record<GoalConflictTable, { id: string }[]> = {
    pm_goals: fresh.goals,
    pm_goal_runs: fresh.goalRuns,
    pm_goal_stations: fresh.stations,
  };
  const merged = mergeConflicts(state.goalConflicts, found, (table, id) =>
    rows[table].some((r) => r.id === id)
  );
  const known = new Set(state.goalConflicts.map((c) => `${c.table}/${c.id}`));
  const added = merged.filter((c) => !known.has(`${c.table}/${c.id}`));
  if (added.length > 0) {
    const showToast = (state as Partial<ToastSlice>).showToast;
    showToast?.(
      added.length === 1
        ? `An agent changed ${added[0].columns.join(', ')} while you were editing it. Your change is not saved yet: keep it or take the agent's value.`
        : `An agent changed ${added.length} goal items while you were editing them. Your changes are not saved yet: keep them or take the agent's values.`,
      'error'
    );
  }
  return merged;
}

export const createGoalsSlice: StateCreator<GoalsSlice> = (set, get) => ({
  goals: [],
  goalsLoading: IDLE_LOAD_STATE.loading,
  goalsLoadError: IDLE_LOAD_STATE.error,
  goalRuns: [],
  goalRequirementLinks: [],
  goalStations: [],
  goalDependencies: [],
  goalsDraft: [],
  goalRunsDraft: [],
  goalRequirementLinksDraft: [],
  goalStationsDraft: [],
  goalDependenciesDraft: [],
  goalsDirty: false,
  goalConflicts: [],
  currentGoalsProject: null,
  goalsModalOpen: false,
  selectedGoalId: null,
  orchestrationOpen: false,
  goalLinesOpen: false,
  goalLinesReturnToGoals: false,

  loadGoals: (projectPath) =>
    trackLoad(
      (s) => writeChanged(set, get(), { goalsLoading: s.loading, goalsLoadError: s.error }),
      async () => {
        await initProjectDb(projectPath);
        const state: GoalsState = await ipcGoalsLoad(projectPath);
        const { goalsDirty, currentGoalsProject } = get();
        const isNewProject = currentGoalsProject !== projectPath;

        if (!goalsDirty || isNewProject) {
          writeChanged(set, get(), {
            goals: state.goals,
            goalsDraft: state.goals,
            goalRuns: state.goalRuns,
            goalRunsDraft: state.goalRuns,
            goalRequirementLinks: state.requirementLinks,
            goalRequirementLinksDraft: state.requirementLinks,
            goalStations: state.stations,
            goalStationsDraft: state.stations,
            goalDependencies: state.dependencies,
            goalDependenciesDraft: state.dependencies,
            goalsDirty: false,
            goalConflicts: [],
            currentGoalsProject: projectPath,
          });
        } else {
          // Dirty draft: keep the fields the person edited, take everything
          // else from the database — values an MCP agent changed on existing
          // rows as much as rows it created. A draft left stale here would be
          // written back on the next save (MET-01). A field both sides changed
          // keeps the person's value and pins the row's base, so the reload
          // alone never counts the agent's value as seen.
          const { goalsDraft, goalRunsDraft, goalRequirementLinks } = get();
          const { goalRequirementLinksDraft, goalStationsDraft } = get();
          const { goalDependencies, goalDependenciesDraft } = get();
          const bases = pinnedBases(get());
          const found = [
            ...pinClashes(
              'pm_goals',
              findClashes(goalsDraft, bases.goals, state.goals),
              bases.goals
            ),
            ...pinClashes(
              'pm_goal_runs',
              findClashes(goalRunsDraft, bases.goalRuns, state.goalRuns),
              bases.goalRuns
            ),
            ...pinClashes(
              'pm_goal_stations',
              findClashes(goalStationsDraft, bases.goalStations, state.stations),
              bases.goalStations
            ),
          ];
          const rebasedGoalsDraft = rebaseDraft(goalsDraft, bases.goals, state.goals);
          const rebasedDependenciesDraft = rebaseDraft(
            goalDependenciesDraft,
            goalDependencies,
            state.dependencies
          );
          const guarded = guardDependencyDraft(
            get(),
            { goals: state.goals, edges: state.dependencies },
            rebasedGoalsDraft,
            rebasedDependenciesDraft
          );
          writeChanged(set, get(), {
            goals: state.goals,
            goalRuns: state.goalRuns,
            goalRequirementLinks: state.requirementLinks,
            goalStations: state.stations,
            goalsDraft: guarded.goals,
            goalRunsDraft: rebaseDraft(goalRunsDraft, bases.goalRuns, state.goalRuns),
            goalRequirementLinksDraft: rebaseDraft(
              goalRequirementLinksDraft,
              goalRequirementLinks,
              state.requirementLinks
            ),
            goalStationsDraft: rebaseDraft(goalStationsDraft, bases.goalStations, state.stations),
            goalDependencies: state.dependencies,
            goalDependenciesDraft: guarded.edges,
            goalConflicts: noteConflicts(get(), found, state),
            currentGoalsProject: projectPath,
          });
        }
      },
      { background: get().currentGoalsProject === projectPath }
    ),

  saveGoals: (projectPath) => {
    // code-gate: complexity-function-length - one sequential unit (diff -> send -> reload -> reconcile CAS conflicts -> commit) sharing ~10 local bindings; splitting it would mean threading them all through helper signatures for no clarity gain. The dependency-recovery part is already pulled out into saveGoalsRecoveringDependencyDraft above.
    const doSave = async (): Promise<void> => {
      await initProjectDb(projectPath);
      const {
        goals,
        goalRuns,
        goalRequirementLinks,
        goalStations,
        goalDependencies,
        goalsDraft,
        goalRunsDraft,
        goalRequirementLinksDraft,
        goalStationsDraft,
        goalDependenciesDraft,
      } = get();
      const bases = pinnedBases(get());

      // Send only what the person changed, each edit with the row it was made
      // from (a conflicted row with its pinned base): Rust writes just the
      // differing columns, and only while the database still holds that base,
      // so whatever an MCP agent wrote meanwhile survives. Deletions are the
      // rows in the persisted baseline that are gone from the draft.
      const draftGoalIds = new Set(goalsDraft.map((g) => g.id));
      const draftRunIds = new Set(goalRunsDraft.map((r) => r.id));
      const draftLinkIds = new Set(goalRequirementLinksDraft.map((l) => l.id));
      const draftStationIds = new Set(goalStationsDraft.map((s) => s.id));
      const draftDependencyIds = new Set(goalDependenciesDraft.map((d) => d.id));
      const editedGoals = editedRows(goalsDraft, bases.goals);
      const editedRuns = editedRows(goalRunsDraft, bases.goalRuns);
      const editedStations = editedRows(goalStationsDraft, bases.goalStations);
      const result = await saveGoalsRecoveringDependencyDraft(projectPath, get().loadGoals, () =>
        ipcGoalsSave(projectPath, {
          goals: editedGoals.rows,
          goalRuns: editedRuns.rows,
          requirementLinks: editedRows(goalRequirementLinksDraft, goalRequirementLinks).rows,
          stations: editedStations.rows,
          dependencies: editedRows(goalDependenciesDraft, goalDependencies).rows,
          baseGoals: editedGoals.bases,
          baseGoalRuns: editedRuns.bases,
          baseStations: editedStations.bases,
          deletedGoalIds: goals.filter((g) => !draftGoalIds.has(g.id)).map((g) => g.id),
          deletedRunIds: goalRuns.filter((r) => !draftRunIds.has(r.id)).map((r) => r.id),
          deletedLinkIds: goalRequirementLinks
            .filter((l) => !draftLinkIds.has(l.id))
            .map((l) => l.id),
          deletedStationIds: goalStations
            .filter((s) => !draftStationIds.has(s.id))
            .map((s) => s.id),
          deletedDependencyIds: goalDependencies
            .filter((d) => !draftDependencyIds.has(d.id))
            .map((d) => d.id),
        })
      );
      const found = result.conflicts.flatMap((c) => {
        const sent: Record<GoalConflictTable, { id: string }[]> = {
          pm_goals: editedGoals.bases,
          pm_goal_runs: editedRuns.bases,
          pm_goal_stations: editedStations.bases,
        };
        const table = c.table as GoalConflictTable;
        return sent[table] ? pinClashes(table, [c], sent[table]) : [];
      });
      const refused = (table: GoalConflictTable) =>
        new Set(found.filter((c) => c.table === table).map((c) => c.id));

      // The database now holds the saved edits plus whatever MCP agents wrote.
      // It becomes the new baseline; edits made while the save was in flight
      // are re-applied on top of it rather than dropped. A row the sync
      // refused was not saved: its edit is re-applied against its pinned base.
      const loaded = await ipcGoalsLoad(projectPath);
      const now = get();
      const savedFrom = <T extends { id: string }>(
        saved: T[],
        pinned: T[],
        table: GoalConflictTable
      ): T[] => {
        const ids = refused(table);
        const pins = new Map(pinned.map((r) => [r.id, r]));
        return saved.map((r) => (ids.has(r.id) ? (pins.get(r.id) ?? r) : r));
      };
      const savedBases = {
        goals: savedFrom(goalsDraft, bases.goals, 'pm_goals'),
        goalRuns: savedFrom(goalRunsDraft, bases.goalRuns, 'pm_goal_runs'),
        goalStations: savedFrom(goalStationsDraft, bases.goalStations, 'pm_goal_stations'),
      };
      const rebased = {
        goalsDraft: rebaseDraft(now.goalsDraft, savedBases.goals, loaded.goals),
        goalRunsDraft: rebaseDraft(now.goalRunsDraft, savedBases.goalRuns, loaded.goalRuns),
        goalRequirementLinksDraft: rebaseDraft(
          now.goalRequirementLinksDraft,
          goalRequirementLinksDraft,
          loaded.requirementLinks
        ),
        goalStationsDraft: rebaseDraft(
          now.goalStationsDraft,
          savedBases.goalStations,
          loaded.stations
        ),
        goalDependenciesDraft: rebaseDraft(
          now.goalDependenciesDraft,
          goalDependenciesDraft,
          loaded.dependencies
        ),
      };
      // The window between the sync and this load: the person may have edited
      // a field that an agent changed in the database meanwhile. Same check as
      // a watcher reload, against what the save left in the database.
      const inFlight = [
        ...pinClashes(
          'pm_goals',
          findClashes(now.goalsDraft, savedBases.goals, loaded.goals),
          savedBases.goals
        ),
        ...pinClashes(
          'pm_goal_runs',
          findClashes(now.goalRunsDraft, savedBases.goalRuns, loaded.goalRuns),
          savedBases.goalRuns
        ),
        ...pinClashes(
          'pm_goal_stations',
          findClashes(now.goalStationsDraft, savedBases.goalStations, loaded.stations),
          savedBases.goalStations
        ),
      ];
      const editedMeanwhile =
        now.goalsDraft !== goalsDraft ||
        now.goalRunsDraft !== goalRunsDraft ||
        now.goalRequirementLinksDraft !== goalRequirementLinksDraft ||
        now.goalStationsDraft !== goalStationsDraft ||
        now.goalDependenciesDraft !== goalDependenciesDraft;
      // Pins of rows that went through are released: those edits are saved.
      const kept = now.goalConflicts.filter((c) => refused(c.table).has(c.id));
      const goalConflicts = noteConflicts(
        { ...now, goalConflicts: kept },
        [...found, ...inFlight],
        loaded
      );
      set({
        goals: loaded.goals,
        goalRuns: loaded.goalRuns,
        goalRequirementLinks: loaded.requirementLinks,
        goalStations: loaded.stations,
        goalDependencies: loaded.dependencies,
        ...rebased,
        goalConflicts,
        goalsDirty: editedMeanwhile || goalConflicts.length > 0,
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
      goalDependencies: [],
      goalDependenciesDraft: [],
      goalsDirty: false,
      goalConflicts: [],
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
      goalDependencies: [],
      goalDependenciesDraft: [],
      goalsDirty: false,
      goalConflicts: [],
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
      goalDependenciesDraft: s.goalDependenciesDraft.filter(
        (d) => !doomed.has(d.goalId) && !doomed.has(d.dependsOnGoalId)
      ),
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

  addGoalDependency: (goalId, dependsOnGoalId) => {
    const { goalsDraft, goalDependenciesDraft } = get();
    const alreadyThere = goalDependenciesDraft.some(
      (d) => d.goalId === goalId && d.dependsOnGoalId === dependsOnGoalId
    );
    if (alreadyThere) return { ok: true };
    // Reject only what THIS edge introduces, not the full edge set: a
    // problem elsewhere in the tree (an older build, a concurrent write not
    // yet reconciled) must not block an unrelated addition.
    const beforeEdges = toDependencyEdges(goalDependenciesDraft);
    const afterEdges = [...beforeEdges, { goalId, dependsOnGoalId }];
    const error = getIntroducedDependencyErrors(
      { goals: goalsDraft, edges: beforeEdges },
      { goals: goalsDraft, edges: afterEdges }
    ).find((e) => e.goalId === goalId && e.dependsOnGoalId === dependsOnGoalId);
    if (error) return { ok: false, error };
    set((s) => ({
      goalDependenciesDraft: [
        ...s.goalDependenciesDraft,
        { id: crypto.randomUUID(), goalId, dependsOnGoalId, createdAt: nowTimestamp() },
      ],
      goalsDirty: true,
    }));
    return { ok: true };
  },

  removeGoalDependency: (goalId, dependsOnGoalId) =>
    set((s) => ({
      goalDependenciesDraft: s.goalDependenciesDraft.filter(
        (d) => !(d.goalId === goalId && d.dependsOnGoalId === dependsOnGoalId)
      ),
      goalsDirty: true,
    })),

  setGoalBundle: (goalId, bundle) => {
    const { goalsDraft, goalDependenciesDraft } = get();
    const normalized = normalizeBundle(bundle);
    const candidateGoals = goalsDraft.map((g) =>
      g.id === goalId ? { ...g, bundle: normalized } : g
    );
    // A bundle change can turn an existing edge into a same-bundle or cycle
    // violation for any pair, not only ones touching this goal, so the whole
    // edge set is re-checked. Only what this change introduces rejects it — a
    // problem the tree already had is not this edit's to fix.
    const edges = toDependencyEdges(goalDependenciesDraft);
    const [error] = getIntroducedDependencyErrors(
      { goals: goalsDraft, edges },
      { goals: candidateGoals, edges }
    );
    if (error) return { ok: false, error };
    set((s) => ({
      goalsDraft: s.goalsDraft.map((g) =>
        g.id === goalId ? { ...g, bundle: normalized, updatedAt: nowTimestamp() } : g
      ),
      goalsDirty: true,
    }));
    return { ok: true };
  },

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

  persistGoalRun: async (projectPath, runId) => {
    await initProjectDb(projectPath);
    // Read after the await and invoke in the same tick: writes then reach the
    // backend in the order the state was read, so a start written late cannot
    // overwrite the finish.
    const run = get().goalRunsDraft.find((r) => r.id === runId);
    if (!run) return;
    await ipcGoalsSave(projectPath, {
      goals: [],
      goalRuns: [run],
      requirementLinks: [],
      stations: [],
      dependencies: [],
      deletedGoalIds: [],
      deletedRunIds: [],
      deletedLinkIds: [],
      deletedStationIds: [],
      deletedDependencyIds: [],
    });
    // The row is stored now; the baseline learns it so a later discard or
    // save treats it as persisted, not as a local addition.
    set((s) => ({ goalRuns: [...s.goalRuns.filter((r) => r.id !== run.id), run] }));
  },

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
    const { goals, goalRuns, goalRequirementLinks, goalStations, goalDependencies } = get();
    set({
      goalsDraft: goals,
      goalRunsDraft: goalRuns,
      goalRequirementLinksDraft: goalRequirementLinks,
      goalStationsDraft: goalStations,
      goalDependenciesDraft: goalDependencies,
      goalsDirty: false,
      goalConflicts: [],
    });
  },

  resolveGoalConflict: (table, id, choice) =>
    set((s) => {
      const goalConflicts = s.goalConflicts.filter((c) => !(c.table === table && c.id === id));
      // 'mine': dropping the pin makes the database row the base, so the
      // agent's value now counts as seen and the next save may replace it.
      if (choice === 'mine') return { goalConflicts };
      // 'theirs': the clashing fields go back to what the database holds; the
      // person's other edits on the row stay and are saved against it.
      const columns = s.goalConflicts.find((c) => c.table === table && c.id === id)?.columns ?? [];
      const takeTheirs = <T extends { id: string }>(draft: T[], persisted: T[]): T[] => {
        const theirs = persisted.find((r) => r.id === id);
        if (!theirs) return draft;
        return draft.map((r) => {
          if (r.id !== id) return r;
          const merged = { ...r };
          for (const column of columns as (keyof T)[]) merged[column] = theirs[column];
          return merged;
        });
      };
      if (table === 'pm_goals') {
        return { goalConflicts, goalsDraft: takeTheirs(s.goalsDraft, s.goals) };
      }
      if (table === 'pm_goal_runs') {
        return { goalConflicts, goalRunsDraft: takeTheirs(s.goalRunsDraft, s.goalRuns) };
      }
      return {
        goalConflicts,
        goalStationsDraft: takeTheirs(s.goalStationsDraft, s.goalStations),
      };
    }),

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

  skipStation: (id, reason) => {
    const note = reason.trim();
    if (note === '') return;
    const ts = nowTimestamp();
    set((s) => {
      const target = s.goalStationsDraft.find((st) => st.id === id);
      if (!target || target.kind !== 'normal' || target.status === 'done') return {};
      return {
        goalStationsDraft: s.goalStationsDraft.map((st) =>
          st.id === id
            ? {
                ...st,
                status: 'skipped',
                evidenceKind: 'claim',
                evidenceNote: note,
                lastCheckedAt: null,
                doneAt: null,
                updatedAt: ts,
              }
            : st
        ),
        goalsDirty: true,
      };
    });
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
  // Picking a goal replaces an epic the conductor panel was preloaded with:
  // the panel must never offer two scopes at once.
  setSelectedGoalId: (id) =>
    set({
      selectedGoalId: id,
      ...(id !== null && { conductorScopeEpicId: null }),
    } as Partial<GoalsSlice>),
  setOrchestrationOpen: (open) => set({ orchestrationOpen: open }),
  setGoalLinesOpen: (open, opts) =>
    set({
      goalLinesOpen: open,
      goalLinesReturnToGoals: open ? Boolean(opts?.fromGoals) : false,
    }),
});
