/**
 * The table behind a parent goal's "Table" view and its CSV/XLSX export.
 *
 * One definition of the rows, so the screen, the CSV and the workbook cannot
 * disagree. Every figure comes from the helper the rest of the app already
 * uses (progress, usage sums, goal timing); nothing is summed a second way.
 * An unknown cost stays empty, never zero, and a note says how many runs the
 * cost total is missing.
 */

import type { AgentUsageRow } from '@/lib/tauri/agentUsage';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { getGoalChildren } from '@/lib/store/goals/goalTreeHelpers';
import { getGoalWorkProgress } from '@/lib/store/goals/goalSatisfaction';
import { sumUsage, usageForGoalSubtree, type UsageTotals } from '@/lib/pm/usage/aggregate';
import { computeGoalMetrics, type GoalHistoryEntry } from '@/lib/pm/metrics/goalMetrics';
import { formatDuration } from '@/lib/pm/metrics/time';

export const GOAL_TABLE_COLUMNS = [
  'name',
  'status',
  'priority',
  'progress',
  'cost',
  'runs',
  'tokens',
  'leadTime',
  'cycleTime',
  'reviewRounds',
] as const;
export type GoalTableColumn = (typeof GOAL_TABLE_COLUMNS)[number];

export const DEFAULT_GOAL_TABLE_COLUMNS: readonly GoalTableColumn[] = [
  'name',
  'status',
  'progress',
  'cost',
];

export const GOAL_TABLE_COLUMN_LABEL: Record<GoalTableColumn, string> = {
  name: 'Name',
  status: 'Status',
  priority: 'Priority',
  progress: 'Progress',
  cost: 'Cost (USD)',
  runs: 'Runs',
  tokens: 'Tokens',
  leadTime: 'Lead time',
  cycleTime: 'Cycle time',
  reviewRounds: 'Review rounds',
};

const NUMERIC: ReadonlySet<GoalTableColumn> = new Set(['cost', 'runs', 'tokens', 'reviewRounds']);

export type GoalTableCell = string | number | null;

export interface GoalTableColumnDef {
  id: GoalTableColumn;
  label: string;
  /** Right-aligned, and stored as a number in the workbook. */
  numeric: boolean;
}

export interface GoalTableRow {
  goalId: string;
  cells: GoalTableCell[];
}

export interface GoalTableData {
  columns: GoalTableColumnDef[];
  rows: GoalTableRow[];
  totals: GoalTableCell[];
  /** Caveats that belong next to the numbers, e.g. runs missing from the cost. */
  notes: string[];
}

export interface BuildGoalTableInput {
  parentId: string;
  goals: readonly PmGoal[];
  tickets: readonly PmTicket[];
  stations: readonly PmGoalStation[];
  usageRows: readonly AgentUsageRow[];
  history: readonly GoalHistoryEntry[];
  columns: readonly GoalTableColumn[];
  now?: number;
}

interface RowFacts {
  goal: PmGoal;
  progress: { done: number; total: number };
  usage: UsageTotals;
  metrics: ReturnType<typeof computeGoalMetrics>;
}

const duration = (ms: number | null) => (ms === null ? null : formatDuration(ms));

function cellFor(column: GoalTableColumn, f: RowFacts): GoalTableCell {
  switch (column) {
    case 'name':
      return f.goal.name;
    case 'status':
      return f.goal.status;
    case 'priority':
      return f.goal.priority;
    case 'progress':
      return `${f.progress.done}/${f.progress.total}`;
    case 'cost':
      return f.usage.costKnownRuns > 0 ? f.usage.costUsd : null;
    case 'runs':
      return f.usage.runs;
    case 'tokens':
      return f.usage.totalTokens;
    case 'leadTime':
      return duration(f.metrics.leadTime);
    case 'cycleTime':
      return duration(f.metrics.cycleTime);
    case 'reviewRounds':
      return f.metrics.reviewRounds;
  }
}

function totalFor(column: GoalTableColumn, facts: RowFacts[]): GoalTableCell {
  switch (column) {
    case 'name':
      return 'Total';
    case 'progress': {
      const done = facts.reduce((n, f) => n + f.progress.done, 0);
      const total = facts.reduce((n, f) => n + f.progress.total, 0);
      return `${done}/${total}`;
    }
    case 'cost': {
      const known = facts.filter((f) => f.usage.costKnownRuns > 0);
      return known.length > 0 ? known.reduce((n, f) => n + f.usage.costUsd, 0) : null;
    }
    case 'runs':
      return facts.reduce((n, f) => n + f.usage.runs, 0);
    case 'tokens':
      return facts.reduce((n, f) => n + f.usage.totalTokens, 0);
    case 'reviewRounds':
      return facts.reduce((n, f) => n + f.metrics.reviewRounds, 0);
    default:
      // Status, priority and the durations do not add up.
      return null;
  }
}

function costNote(facts: RowFacts[], columns: readonly GoalTableColumn[]): string[] {
  if (!columns.includes('cost')) return [];
  const missing = facts.reduce((n, f) => n + f.usage.unknownCostRuns, 0);
  if (missing === 0) return [];
  return [`Cost excludes ${missing} ${missing === 1 ? 'run' : 'runs'} without a known price.`];
}

/** The direct sub-goals of `parentId`, one row each, plus totals and notes. */
export function buildGoalTable(input: BuildGoalTableInput): GoalTableData {
  const { parentId, goals, tickets, stations, usageRows, history, now = Date.now() } = input;
  const columns = GOAL_TABLE_COLUMNS.filter((c) => input.columns.includes(c));
  const ordered = [...goals];

  const facts: RowFacts[] = getGoalChildren(ordered, parentId).map((goal) => {
    const progress = getGoalWorkProgress(ordered, [...tickets], [...stations], goal.id);
    return {
      goal,
      progress: { done: progress.done, total: progress.total },
      usage: sumUsage(usageForGoalSubtree(usageRows, goal, ordered, tickets)),
      metrics: computeGoalMetrics([...history], goal.status, now, goal.id),
    };
  });

  return {
    columns: columns.map((id) => ({
      id,
      label: GOAL_TABLE_COLUMN_LABEL[id],
      numeric: NUMERIC.has(id),
    })),
    rows: facts.map((f) => ({ goalId: f.goal.id, cells: columns.map((c) => cellFor(c, f)) })),
    totals: columns.map((c) => totalFor(c, facts)),
    notes: costNote(facts, columns),
  };
}

/** The stored choice is a JSON list; anything unusable falls back to the defaults. */
export function parseGoalTableColumns(raw: string | null): GoalTableColumn[] {
  const fallback = [...DEFAULT_GOAL_TABLE_COLUMNS];
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const known = GOAL_TABLE_COLUMNS.filter((c) => parsed.includes(c));
    return known.length > 0 ? known : fallback;
  } catch {
    return fallback;
  }
}

export function serializeGoalTableColumns(columns: readonly GoalTableColumn[]): string {
  return JSON.stringify(columns);
}

/** Turns one column on or off, keeping the canonical order. The last column stays on. */
export function toggleGoalTableColumn(
  columns: readonly GoalTableColumn[],
  column: GoalTableColumn
): GoalTableColumn[] {
  const next = columns.includes(column)
    ? columns.filter((c) => c !== column)
    : [...columns, column];
  return next.length === 0 ? [...columns] : GOAL_TABLE_COLUMNS.filter((c) => next.includes(c));
}

const csvCell = (cell: GoalTableCell): string => {
  if (cell === null) return '';
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** RFC 4180, CRLF line ends, with a BOM so Excel reads UTF-8 correctly. */
export function toCsv(table: GoalTableData): string {
  const lines = [
    table.columns.map((c) => csvCell(c.label)),
    ...table.rows.map((r) => r.cells.map(csvCell)),
    table.totals.map(csvCell),
  ].map((cells) => cells.join(','));
  const notes = table.notes.map(csvCell);
  return `﻿${[...lines, ...notes].join('\r\n')}\r\n`;
}
