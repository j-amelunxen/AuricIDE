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
}

/** GoalsState as loaded over IPC, before predicates are parsed. */
interface GoalsStateWire {
  goals: PmGoal[];
  goalRuns: PmGoalRun[];
  requirementLinks: PmGoalRequirementLink[];
  stations?: PmGoalStationWire[];
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
}

import { invoke } from './invoke';

export async function goalsLoad(projectPath: string): Promise<GoalsState> {
  const wire = await invoke<GoalsStateWire>('goals_load', { projectPath });
  return { ...wire, stations: (wire.stations ?? []).map(parseStationRow) };
}

export async function goalsSave(projectPath: string, payload: GoalsSyncPayload): Promise<void> {
  await invoke('goals_save', {
    projectPath,
    payload: { ...payload, stations: payload.stations.map(serializeStationRow) },
  });
}

export async function goalsClear(projectPath: string): Promise<void> {
  await invoke('goals_clear', { projectPath });
}
