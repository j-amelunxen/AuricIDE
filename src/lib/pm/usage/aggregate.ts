/**
 * The only place agent-usage sums are computed (contract:
 * docs/design-agent-usage.md). Every view and the MCP tools go through here, so
 * a total means the same thing wherever it is shown.
 *
 * The one rule that shapes all of it: an unknown cost is not zero. It adds no
 * money to a total, but the run is counted in `unknownCostRuns`, so a total
 * that is missing money says so instead of looking complete.
 */

import type { AgentUsageRow } from '@/lib/tauri/agentUsage';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { getGoalDescendants, type GoalTreeNode } from '@/lib/store/goals/goalTreeHelpers';

export interface UsageTotals {
  runs: number;
  /** Sum of the known costs only. */
  costUsd: number;
  costKnownRuns: number;
  /** Runs whose cost was priced from a transcript rather than reported by the CLI. */
  estimatedRuns: number;
  unknownCostRuns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Everything billed. Reasoning is left out: it is already inside `outputTokens`. */
  totalTokens: number;
  durationMs: number;
}

/** The ticket fields the aggregation reads. */
export type TicketRef = Pick<PmTicket, 'id' | 'epicId' | 'status' | 'goalId'> &
  Partial<Pick<PmTicket, 'name'>>;

export type UsageGroupBy = 'ticket' | 'status' | 'epic' | 'goal' | 'provider' | 'model' | 'day';
export type UsageWindow = '7d' | '30d' | 'all';

export interface UsageGroupContext {
  tickets: readonly TicketRef[];
  goals: readonly Pick<PmGoal, 'id' | 'name'>[];
  epics: readonly { id: string; name: string }[];
}

export interface UsageGroup {
  key: string;
  label: string;
  totals: UsageTotals;
}

export interface EstimateDeviation {
  n: number;
  meanAbsPct: number;
  medianAbsPct: number;
  maxAbsPct: number;
}

const UNATTRIBUTED = '—';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS: Record<Exclude<UsageWindow, 'all'>, number> = { '7d': 7, '30d': 30 };

export function sumUsage(rows: readonly AgentUsageRow[]): UsageTotals {
  const totals: UsageTotals = {
    runs: 0,
    costUsd: 0,
    costKnownRuns: 0,
    estimatedRuns: 0,
    unknownCostRuns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
  for (const row of rows) {
    totals.runs += 1;
    if (row.costUsd === null) {
      totals.unknownCostRuns += 1;
    } else {
      totals.costUsd += row.costUsd;
      totals.costKnownRuns += 1;
    }
    if (row.costSource === 'estimated') totals.estimatedRuns += 1;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
    totals.durationMs += row.durationMs;
  }
  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return totals;
}

export function usageForTicket(rows: readonly AgentUsageRow[], ticketId: string): AgentUsageRow[] {
  return rows.filter((row) => row.ticketId === ticketId);
}

/**
 * Runs on the goal or any descendant goal, plus runs on tickets linked into
 * that subtree. Each row is tested once, so a run that names both a ticket and
 * its goal cannot be counted twice.
 */
export function usageForGoalSubtree(
  rows: readonly AgentUsageRow[],
  goal: Pick<PmGoal, 'id'>,
  goals: readonly GoalTreeNode[],
  tickets: readonly TicketRef[]
): AgentUsageRow[] {
  const goalIds = new Set([goal.id, ...getGoalDescendants([...goals], goal.id).map((g) => g.id)]);
  const ticketIds = new Set(
    tickets.filter((t) => !!t.goalId && goalIds.has(t.goalId)).map((t) => t.id)
  );
  return rows.filter(
    (row) =>
      (row.goalId !== null && goalIds.has(row.goalId)) ||
      (row.ticketId !== null && ticketIds.has(row.ticketId))
  );
}

interface Bucket {
  key: string;
  label: string;
}

function bucketFor(row: AgentUsageRow, by: UsageGroupBy, ctx: UsageGroupContext): Bucket {
  const ticket = row.ticketId === null ? undefined : ctx.tickets.find((t) => t.id === row.ticketId);
  const unattributed = { key: UNATTRIBUTED, label: UNATTRIBUTED };
  switch (by) {
    case 'ticket':
      return row.ticketId === null
        ? unattributed
        : { key: row.ticketId, label: ticket?.name ?? row.ticketId };
    case 'status':
      return ticket ? { key: ticket.status, label: ticket.status } : unattributed;
    case 'epic': {
      if (!ticket) return unattributed;
      const epic = ctx.epics.find((e) => e.id === ticket.epicId);
      return { key: ticket.epicId, label: epic?.name ?? ticket.epicId };
    }
    case 'goal': {
      const goalId = row.goalId ?? ticket?.goalId ?? null;
      if (goalId === null) return unattributed;
      const goal = ctx.goals.find((g) => g.id === goalId);
      return { key: goalId, label: goal?.name ?? goalId };
    }
    case 'provider':
      return { key: row.provider, label: row.provider };
    case 'model':
      return row.model ? { key: row.model, label: row.model } : unattributed;
    case 'day': {
      const day = row.finishedAt.slice(0, 10);
      return { key: day, label: day };
    }
  }
}

/** Costliest group first, unattributed last; days read oldest to newest. */
function compareGroups(by: UsageGroupBy) {
  return (a: UsageGroup, b: UsageGroup): number => {
    if (by === 'day') return a.key.localeCompare(b.key);
    if (a.key === UNATTRIBUTED) return b.key === UNATTRIBUTED ? 0 : 1;
    if (b.key === UNATTRIBUTED) return -1;
    return b.totals.costUsd - a.totals.costUsd || b.totals.runs - a.totals.runs;
  };
}

export function groupUsage(
  rows: readonly AgentUsageRow[],
  by: UsageGroupBy,
  ctx: UsageGroupContext
): UsageGroup[] {
  const buckets = new Map<string, { label: string; rows: AgentUsageRow[] }>();
  for (const row of rows) {
    const { key, label } = bucketFor(row, by, ctx);
    const bucket = buckets.get(key) ?? { label, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: bucket.label, totals: sumUsage(bucket.rows) }))
    .sort(compareGroups(by));
}

export function withinWindow(
  rows: readonly AgentUsageRow[],
  window: UsageWindow,
  now: Date
): AgentUsageRow[] {
  if (window === 'all') return [...rows];
  const cutoff = now.getTime() - WINDOW_DAYS[window] * DAY_MS;
  return rows.filter((row) => Date.parse(row.finishedAt) >= cutoff);
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How far our transcript pricing is from the CLI's own figure, over the runs
 * that have both. The CLI cost is the reference, so estimated-only rows (whose
 * cost is the estimate) and a $0 reference (a percentage of zero) are left out.
 */
export function estimateDeviation(rows: readonly AgentUsageRow[]): EstimateDeviation | null {
  const deviations = rows
    .filter(
      (row) =>
        row.costSource === 'cli' &&
        row.costUsd !== null &&
        row.costUsd > 0 &&
        row.estimateCostUsd !== null
    )
    .map(
      (row) =>
        (Math.abs((row.estimateCostUsd ?? 0) - (row.costUsd ?? 0)) / (row.costUsd ?? 1)) * 100
    )
    .sort((a, b) => a - b);
  if (deviations.length === 0) return null;
  return {
    n: deviations.length,
    meanAbsPct: deviations.reduce((sum, d) => sum + d, 0) / deviations.length,
    medianAbsPct: median(deviations),
    maxAbsPct: deviations[deviations.length - 1],
  };
}
