import type {
  GoalsState,
  PmGoal,
  PmGoalDependency,
  PmGoalRequirementLink,
  PmGoalRun,
  PmGoalStation,
  StationSourceContext,
} from '@/lib/goals/types';
import { parseStoredPredicateJson } from '@/lib/goals/planner/plannerSchema';

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

function serializeStationRow(station: PmGoalStation): PmGoalStationWire {
  const { sourceContext, ...rest } = station;
  return {
    ...rest,
    predicate: JSON.stringify(station.predicate),
    sourceContext: JSON.stringify(sourceContext ?? null),
  };
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
