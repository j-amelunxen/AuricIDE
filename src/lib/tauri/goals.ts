export type GoalStatus = 'draft' | 'active' | 'in_progress' | 'achieved' | 'failed' | 'archived';
export type GoalPriority = 'low' | 'normal' | 'high' | 'critical';
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

export interface GoalsState {
  goals: PmGoal[];
  goalRuns: PmGoalRun[];
  requirementLinks: PmGoalRequirementLink[];
}

/**
 * Row-level sync payload: upserts plus explicit deletions. Rows written
 * concurrently by MCP agents survive a frontend save untouched.
 */
export interface GoalsSyncPayload extends GoalsState {
  deletedGoalIds: string[];
  deletedRunIds: string[];
  deletedLinkIds: string[];
}

import { invoke } from './invoke';

export async function goalsLoad(projectPath: string): Promise<GoalsState> {
  return await invoke<GoalsState>('goals_load', { projectPath });
}

export async function goalsSave(projectPath: string, payload: GoalsSyncPayload): Promise<void> {
  await invoke('goals_save', { projectPath, payload });
}

export async function goalsClear(projectPath: string): Promise<void> {
  await invoke('goals_clear', { projectPath });
}
