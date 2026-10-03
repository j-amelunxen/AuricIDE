import { describe, expect, it } from 'vitest';
import type { AgentUsageRow } from '@/lib/tauri/agentUsage';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { GoalHistoryEntry } from '@/lib/pm/metrics/goalMetrics';
import {
  GOAL_TABLE_COLUMNS,
  DEFAULT_GOAL_TABLE_COLUMNS,
  buildGoalTable,
  parseGoalTableColumns,
  toCsv,
} from './goalTable';

function goal(id: string, over: Partial<PmGoal> = {}): PmGoal {
  return {
    id,
    parentId: null,
    name: id,
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'user',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as PmGoal;
}

function ticket(id: string, goalId: string, status = 'done'): PmTicket {
  return { id, epicId: 'e', goalId, status, name: id } as PmTicket;
}

function usage(goalId: string, costUsd: number | null, tokens = 100): AgentUsageRow {
  return {
    goalId,
    ticketId: null,
    costUsd,
    costSource: costUsd === null ? 'none' : 'cli',
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 1000,
  } as AgentUsageRow;
}

const parent = goal('parent');
const a = goal('a', { parentId: 'parent', name: 'Alpha, "one"', sortOrder: 1, status: 'achieved' });
const b = goal('b', { parentId: 'parent', name: 'Beta', sortOrder: 2, priority: 'high' });
const goals = [parent, a, b];
const tickets = [ticket('t1', 'a'), ticket('t2', 'a', 'open'), ticket('t3', 'b')];

function build(
  over: { columns?: string[]; usageRows?: AgentUsageRow[]; history?: GoalHistoryEntry[] } = {}
) {
  return buildGoalTable({
    parentId: 'parent',
    goals,
    tickets,
    stations: [],
    usageRows: over.usageRows ?? [],
    history: over.history ?? [],
    columns: (over.columns ?? ['name', 'progress', 'cost']) as never,
    now: Date.parse('2026-02-01T00:00:00Z'),
  });
}

describe('buildGoalTable', () => {
  it('lists the direct sub-goals in tree order with the chosen columns only', () => {
    const table = build();
    expect(table.columns.map((c) => c.id)).toEqual(['name', 'progress', 'cost']);
    expect(table.rows.map((r) => r.goalId)).toEqual(['a', 'b']);
    expect(table.rows[0].cells[0]).toBe('Alpha, "one"');
  });

  it('shows progress as done/total and sums it in the totals row', () => {
    const table = build();
    expect(table.rows.map((r) => r.cells[1])).toEqual(['1/2', '1/1']);
    expect(table.totals[1]).toBe('2/3');
  });

  it('keeps the cost of a goal with no priced run empty rather than zero', () => {
    const table = build({ usageRows: [usage('a', 1.5), usage('a', 0.5), usage('b', null)] });
    expect(table.rows[0].cells[2]).toBe(2);
    expect(table.rows[1].cells[2]).toBeNull();
    expect(table.totals[2]).toBe(2);
  });

  it('says in a note how many runs are missing from the cost total', () => {
    const table = build({ usageRows: [usage('a', 1), usage('b', null), usage('b', null)] });
    expect(table.notes.join(' ')).toMatch(/2 runs/);
    expect(build({ usageRows: [usage('a', 1)] }).notes).toEqual([]);
  });

  it('counts runs on tickets of a sub-goal toward that sub-goal', () => {
    const row = { ...usage('x', 3), goalId: null, ticketId: 't3' } as AgentUsageRow;
    const table = build({ usageRows: [row] });
    expect(table.rows[1].cells[2]).toBe(3);
  });

  it('fills timing from the goal history and leaves unknown timing blank', () => {
    const history: GoalHistoryEntry[] = [
      {
        goalId: 'a',
        fromStatus: null,
        toStatus: 'draft',
        changedAt: '2026-01-01T00:00:00Z',
        source: 'ui',
      },
      {
        goalId: 'a',
        fromStatus: 'draft',
        toStatus: 'in_progress',
        changedAt: '2026-01-02T00:00:00Z',
        source: 'ui',
      },
      {
        goalId: 'a',
        fromStatus: 'in_progress',
        toStatus: 'achieved',
        changedAt: '2026-01-04T00:00:00Z',
        source: 'ui',
      },
    ] as GoalHistoryEntry[];
    const table = build({ columns: ['name', 'leadTime', 'cycleTime', 'reviewRounds'], history });
    expect(table.rows[0].cells.slice(1)).toEqual(['3d 0h', '2d 0h', 0]);
    expect(table.rows[1].cells.slice(1)).toEqual([null, null, 0]);
  });

  it('returns an empty table body for a goal without sub-goals', () => {
    const table = buildGoalTable({
      parentId: 'a',
      goals,
      tickets,
      stations: [],
      usageRows: [],
      history: [],
      columns: ['name'],
    });
    expect(table.rows).toEqual([]);
  });
});

describe('parseGoalTableColumns', () => {
  it('falls back to the defaults for missing, broken or empty input', () => {
    expect(parseGoalTableColumns(null)).toEqual(DEFAULT_GOAL_TABLE_COLUMNS);
    expect(parseGoalTableColumns('{nope')).toEqual(DEFAULT_GOAL_TABLE_COLUMNS);
    expect(parseGoalTableColumns('{"a":1}')).toEqual(DEFAULT_GOAL_TABLE_COLUMNS);
    expect(parseGoalTableColumns('[]')).toEqual(DEFAULT_GOAL_TABLE_COLUMNS);
  });

  it('drops unknown ids and keeps the canonical column order', () => {
    expect(parseGoalTableColumns('["cost","bogus","name"]')).toEqual(['name', 'cost']);
    expect(GOAL_TABLE_COLUMNS).toContain('name');
  });
});

describe('toCsv', () => {
  it('writes a header, the rows and a totals row with RFC 4180 quoting', () => {
    const csv = toCsv(build({ usageRows: [usage('a', 2)] }));
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Name,Progress,Cost (USD)');
    expect(lines[1]).toBe('"Alpha, ""one""",1/2,2');
    expect(lines[2]).toBe('Beta,1/1,');
    expect(lines[3]).toBe('Total,2/3,2');
  });

  it('starts with a byte-order mark so Excel reads UTF-8 umlauts', () => {
    expect(toCsv(build()).startsWith('﻿')).toBe(true);
  });

  it('appends the notes as trailing lines', () => {
    const csv = toCsv(build({ usageRows: [usage('b', null)] }));
    expect(csv.trimEnd().split('\r\n').at(-1)).toMatch(/1 run/);
  });

  it('quotes a cell that holds a line break', () => {
    const multi = buildGoalTable({
      parentId: 'parent',
      goals: [parent, goal('c', { parentId: 'parent', name: 'two\nlines' })],
      tickets: [],
      stations: [],
      usageRows: [],
      history: [],
      columns: ['name'],
    });
    expect(toCsv(multi)).toContain('"two\nlines"');
  });
});
