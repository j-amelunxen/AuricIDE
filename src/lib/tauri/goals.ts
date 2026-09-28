import type { GoalWorkModeSetting } from '../goals/workMode';
import type { GoalStatusValue, Priority } from '@/lib/pm/enums';
export type GoalStatus = GoalStatusValue;
export type GoalPriority = Priority;
export type GoalActor = 'ui' | 'mcp' | 'conductor' | 'agent';
export type GoalRunOutcome = 'running' | 'completed' | 'failed' | 'killed';

export interface PmGoal {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  successCriteria: string;
  status: GoalStatus;
  priority: GoalPriority;
  /** Canonical prompt artifact used when launching agents for this goal. */
  goalPrompt: string;
  /**
   * How the goal is worked: by tickets or by its stations. Absent reads as
   * `auto` (see `resolveGoalWorkMode`), so goals from before the setting keep
   * behaving as they did.
   */
  workMode?: GoalWorkModeSetting;
  /**
   * Root goals only: the mission folder this goal stands for, relative to the
   * project root (`normalizeMissionPath`). Absent or null means no mission.
   */
  missionPath?: string | null;
  /**
   * Sibling scoping label: goals under the same parent with the same trimmed
   * `bundle` close together (`bundleHold` in `goalDependencies.ts`). Blank or
   * absent means no bundle.
   */
  bundle?: string | null;
  /** Provenance: which actor created this goal. */
  createdBy: GoalActor;
  achievedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmGoalRun {
  id: string;
  goalId: string;
  agentId: string;
  ticketId: string | null;
  /** The exact prompt the agent was launched with — a first-class artifact. */
  prompt: string;
  model: string;
  provider: string;
  /** Provenance: which actor launched this run. */
  source: GoalActor;
  outcome: GoalRunOutcome;
  summary: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface PmGoalRequirementLink {
  id: string;
  goalId: string;
  requirementId: string;
  createdAt: string;
}

/**
 * An edge `goalId -> dependsOnGoalId`: `goalId` is blocked until the target
 * reaches `achieved` or `archived` (see `goalDependencies.ts`). Immutable once
 * written — inserted or deleted, never edited — so it needs no compare-and-swap
 * base the way goal, run and station rows do.
 */
export interface PmGoalDependency {
  id: string;
  goalId: string;
  dependsOnGoalId: string;
  createdAt: string;
}

import type { EvidenceKindValue, StationKind, StationStoredStatus } from '@/lib/pm/enums';
import { parseStoredPredicateJson } from '@/lib/goals/planner/plannerSchema';

/**
 * What would prove a station done. `undefined` is the honest placeholder for
 * "check to be defined" — drawn visibly on the map, never hidden. `human` can
 * only ever be cleared by a person.
 */
export type StationPredicate =
  | { type: 'undefined' }
  | { type: 'human' }
  | { type: 'ticket_done'; ticketId: string }
  | { type: 'requirement_verified'; requirementId: string }
  | { type: 'file_exists'; glob: string }
  | { type: 'git_touches'; pathPrefix: string; sinceIso?: string }
  | { type: 'judged'; prompt: string };

/** Durable provenance for a station created from external source material. */
export interface StationSourceContext {
  importId: string;
  sourcePath: string;
  transcriptSegments: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
  frames: Array<{
    timestampMs: number;
    path: string;
  }>;
  notes: string[];
}

/**
 * One step of a goal's line. In TS the predicate is a parsed object; over IPC
 * it travels as a JSON string (the appliesTo pattern) — `parseStationRow` /
 * `serializeStationRow` are the one boundary.
 */
export interface PmGoalStation {
  id: string;
  goalId: string;
  name: string;
  kind: StationKind;
  status: StationStoredStatus;
  evidenceKind: EvidenceKindValue;
  predicate: StationPredicate;
  evidenceNote: string;
  /** Source notes and screenshots are explanatory context, not completion evidence. */
  sourceContext?: StationSourceContext;
  ticketId: string | null;
  /** Reserved for branch lines; always 0 for now. */
  lane: number;
  sortOrder: number;
  lastCheckedAt: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The station exactly as it crosses IPC: predicate still a JSON string. */
export type PmGoalStationWire = Omit<PmGoalStation, 'predicate' | 'sourceContext'> & {
  predicate: string;
  sourceContext?: string;
};

export function parseStationRow(row: PmGoalStationWire): PmGoalStation {
  // Same field rules as the write/planner boundary — incomplete stored
  // predicates degrade to "undefined" rather than being cast into the union.
  const predicate = parseStoredPredicateJson(row.predicate);
  let sourceContext: StationSourceContext | undefined;
  try {
    const parsed: unknown = row.sourceContext ? JSON.parse(row.sourceContext) : undefined;
    if (parsed && typeof parsed === 'object') sourceContext = parsed as StationSourceContext;
  } catch {
    // Corrupt optional context must not make the process itself unreadable.
  }
  const { sourceContext: _wireContext, ...rest } = row;
  return { ...rest, predicate, ...(sourceContext ? { sourceContext } : {}) };
}

export function serializeStationRow(station: PmGoalStation): PmGoalStationWire {
  const { sourceContext, ...rest } = station;
  return {
    ...rest,
    predicate: JSON.stringify(station.predicate),
    sourceContext: JSON.stringify(sourceContext ?? null),
  };
}

export interface GoalsState {
  goals: PmGoal[];
  goalRuns: PmGoalRun[];
  requirementLinks: PmGoalRequirementLink[];
  stations: PmGoalStation[];
  dependencies: PmGoalDependency[];
}

/** GoalsState as loaded over IPC, before predicates are parsed. */
interface GoalsStateWire {
  goals: PmGoal[];
  goalRuns: PmGoalRun[];
  requirementLinks: PmGoalRequirementLink[];
  stations?: PmGoalStationWire[];
  /** Absent from a backend older than this feature: reads as no dependencies. */
  dependencies?: PmGoalDependency[];
}

/**
 * Row-level sync payload: upserts plus explicit deletions. Rows written
 * concurrently by MCP agents survive a frontend save untouched.
 */
export interface GoalsSyncPayload extends GoalsState {
  deletedGoalIds: string[];
  deletedRunIds: string[];
  deletedLinkIds: string[];
  deletedStationIds: string[];
  deletedDependencyIds: string[];
  /**
   * The persisted rows the sent rows were edited from. With a base, Rust writes
   * only the columns that differ from it, so a concurrent MCP write to another
   * column survives; without one the row is new and upserted whole.
   */
  baseGoals?: PmGoal[];
  baseGoalRuns?: PmGoalRun[];
  baseStations?: PmGoalStation[];
}

import { invoke } from './invoke';

export async function goalsLoad(projectPath: string): Promise<GoalsState> {
  const wire = await invoke<GoalsStateWire>('goals_load', { projectPath });
  return {
    ...wire,
    stations: (wire.stations ?? []).map(parseStationRow),
    dependencies: wire.dependencies ?? [],
  };
}

/** A row the sync left as the database has it: the same columns changed on both sides. */
export interface GoalsSyncConflict {
  table: string;
  id: string;
  /** snake_case column names, sorted. */
  columns: string[];
}

export interface GoalsSyncResult {
  conflicts: GoalsSyncConflict[];
}

export async function goalsSave(
  projectPath: string,
  payload: GoalsSyncPayload
): Promise<GoalsSyncResult> {
  const result = await invoke<GoalsSyncResult | null>('goals_save', {
    projectPath,
    payload: {
      ...payload,
      stations: payload.stations.map(serializeStationRow),
      baseStations: (payload.baseStations ?? []).map(serializeStationRow),
    },
  });
  // A backend from before the compare-and-swap returns nothing: no conflicts.
  return { conflicts: result?.conflicts ?? [] };
}

export async function goalsClear(projectPath: string): Promise<void> {
  await invoke('goals_clear', { projectPath });
}
