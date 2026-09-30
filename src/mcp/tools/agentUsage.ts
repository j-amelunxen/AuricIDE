import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import {
  groupUsage,
  sumUsage,
  usageForGoalSubtree,
  type TicketRef,
  type UsageTotals,
} from '../../lib/pm/usage/aggregate';
import type { AgentUsageRow } from '../../lib/tauri/agentUsage';
import type { PmGoal } from '../../lib/tauri/goals';
import { resolveGoalId, resolveTicketId } from './resolve';

const DEFAULT_LIST_LIMIT = 50;
const SUMMARY_GROUPINGS = ['ticket', 'goal', 'status', 'provider', 'model'] as const;
type SummaryGrouping = (typeof SUMMARY_GROUPINGS)[number];

interface UsageDbRow {
  id: string;
  agent_id: string;
  ticket_id: string | null;
  goal_id: string | null;
  run_kind: AgentUsageRow['runKind'];
  run_source: string;
  provider: string;
  model: string | null;
  headless: number;
  session_id: string | null;
  ticket_status_at_start: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  outcome: AgentUsageRow['outcome'];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  cost_usd: number | null;
  cost_source: AgentUsageRow['costSource'];
  match_kind: AgentUsageRow['matchKind'];
  estimate_cost_usd: number | null;
  estimate_input_tokens: number | null;
  estimate_output_tokens: number | null;
  estimate_cache_read_tokens: number | null;
  estimate_cache_write_tokens: number | null;
  unpriced_models: string | null;
  num_turns: number | null;
}

/** The camelCase shape the frontend's `agent_usage_load` returns, so both read one vocabulary. */
function toUsageRow(row: UsageDbRow): AgentUsageRow {
  return {
    id: row.id,
    agentId: row.agent_id,
    ticketId: row.ticket_id,
    goalId: row.goal_id,
    runKind: row.run_kind,
    runSource: row.run_source,
    provider: row.provider,
    model: row.model,
    headless: row.headless !== 0,
    sessionId: row.session_id,
    ticketStatusAtStart: row.ticket_status_at_start,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    outcome: row.outcome,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningTokens: row.reasoning_tokens,
    costUsd: row.cost_usd,
    costSource: row.cost_source,
    matchKind: row.match_kind,
    estimateCostUsd: row.estimate_cost_usd,
    estimateInputTokens: row.estimate_input_tokens,
    estimateOutputTokens: row.estimate_output_tokens,
    estimateCacheReadTokens: row.estimate_cache_read_tokens,
    estimateCacheWriteTokens: row.estimate_cache_write_tokens,
    unpricedModels: row.unpriced_models === null ? null : JSON.parse(row.unpriced_models),
    numTurns: row.num_turns,
  };
}

function allUsage(db: Database.Database): AgentUsageRow[] {
  const rows = db
    .prepare('SELECT * FROM pm_agent_usage ORDER BY finished_at DESC, started_at DESC')
    .all() as UsageDbRow[];
  return rows.map(toUsageRow);
}

function goalNodes(
  db: Database.Database
): Pick<PmGoal, 'id' | 'name' | 'parentId' | 'sortOrder' | 'createdAt'>[] {
  return db
    .prepare(
      'SELECT id, name, parent_id AS parentId, sort_order AS sortOrder, created_at AS createdAt FROM pm_goals'
    )
    .all() as Pick<PmGoal, 'id' | 'name' | 'parentId' | 'sortOrder' | 'createdAt'>[];
}

function ticketRefs(db: Database.Database): TicketRef[] {
  return db
    .prepare('SELECT id, name, epic_id AS epicId, status, goal_id AS goalId FROM pm_tickets')
    .all() as TicketRef[];
}

export interface ListAgentUsageFilters {
  ticketId?: string;
  goalId?: string;
  since?: string;
  limit?: number;
}

/** Newest first. A goal filter covers the goal's whole subtree, each run once. */
export function listAgentUsage(
  db: Database.Database,
  filters: ListAgentUsageFilters
): AgentUsageRow[] {
  let rows = allUsage(db);
  if (filters.ticketId) {
    const ticketId = resolveTicketId(db, filters.ticketId);
    rows = rows.filter((row) => row.ticketId === ticketId);
  }
  if (filters.goalId) {
    const goalId = resolveGoalId(db, filters.goalId);
    rows = usageForGoalSubtree(rows, { id: goalId }, goalNodes(db), ticketRefs(db));
  }
  const { since } = filters;
  if (since) rows = rows.filter((row) => row.finishedAt >= since);
  return rows.slice(0, filters.limit ?? DEFAULT_LIST_LIMIT);
}

export interface UsageSummary {
  groupBy: SummaryGrouping;
  groups: ({ key: string; label: string } & UsageTotals)[];
  totals: UsageTotals;
}

export function summarizeAgentUsage(db: Database.Database, groupBy: SummaryGrouping): UsageSummary {
  const rows = allUsage(db);
  const groups = groupUsage(rows, groupBy, {
    tickets: ticketRefs(db),
    goals: goalNodes(db),
    epics: [],
  });
  return {
    groupBy,
    groups: groups.map(({ key, label, totals }) => ({ key, label, ...totals })),
    totals: sumUsage(rows),
  };
}

export function registerAgentUsageTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_agent_usage',
    description:
      'List what finished agent runs consumed: tokens and USD cost (list-price equivalent, never a bill), newest first. ' +
      'A null costUsd means the cost is unknown, not zero. A goal filter covers the goal and all its sub-goals, plus tickets linked into them.',
    parameters: z.object({
      ticketId: z.string().optional().describe('Only runs for this ticket (UUID or prefix)'),
      goalId: z.string().optional().describe('Only runs for this goal subtree (UUID or prefix)'),
      since: z.string().optional().describe('ISO timestamp: only runs finished at or after it'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Maximum rows (default ${DEFAULT_LIST_LIMIT})`),
    }),
    execute: async (params) => JSON.stringify(listAgentUsage(db, params)),
  });

  server.addTool({
    name: 'get_usage_summary',
    description:
      'Sum agent-run tokens and USD cost per ticket, goal, ticket status, provider or model. ' +
      'Unknown costs are not counted as zero: they show up in unknownCostRuns.',
    parameters: z.object({
      groupBy: z.enum(SUMMARY_GROUPINGS).describe('What to group the runs by'),
    }),
    execute: async ({ groupBy }) => JSON.stringify(summarizeAgentUsage(db, groupBy)),
  });
}
