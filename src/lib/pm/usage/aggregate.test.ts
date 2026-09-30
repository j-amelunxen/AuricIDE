import { describe, expect, it } from 'vitest';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import {
  estimateDeviation,
  groupUsage,
  sumUsage,
  usageForGoalSubtree,
  usageForTicket,
  withinWindow,
} from './aggregate';
import { usageRow } from './testRow';

function goal(id: string, parentId: string | null = null): PmGoal {
  return { id, parentId, name: `Goal ${id}`, sortOrder: 0, createdAt: '' } as PmGoal;
}

function ticket(id: string, extra: Partial<PmTicket> = {}): PmTicket {
  return { id, epicId: 'e1', name: `Ticket ${id}`, status: 'open', ...extra } as PmTicket;
}

describe('sumUsage', () => {
  it('is all zeros for no rows', () => {
    expect(sumUsage([])).toEqual({
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
    });
  });

  it('adds tokens, duration and cost; total tokens leave reasoning out (it is inside output)', () => {
    const totals = sumUsage([
      usageRow({
        costUsd: 0.5,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        reasoningTokens: 15,
        durationMs: 1000,
      }),
      usageRow({ costUsd: 0.25, inputTokens: 1, durationMs: 500 }),
    ]);
    expect(totals).toMatchObject({
      runs: 2,
      costUsd: 0.75,
      costKnownRuns: 2,
      inputTokens: 11,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      totalTokens: 101,
      durationMs: 1500,
    });
  });

  it('does not count an unknown cost as zero: it keeps the tokens and reports the run', () => {
    const totals = sumUsage([
      usageRow({ costUsd: 1.5 }),
      usageRow({ costUsd: null, costSource: 'none', inputTokens: 7 }),
    ]);
    expect(totals.costUsd).toBe(1.5);
    expect(totals.costKnownRuns).toBe(1);
    expect(totals.unknownCostRuns).toBe(1);
    expect(totals.inputTokens).toBe(7);
  });

  it('counts a genuine $0 run as known, not unknown', () => {
    const totals = sumUsage([usageRow({ costUsd: 0 })]);
    expect(totals.costKnownRuns).toBe(1);
    expect(totals.unknownCostRuns).toBe(0);
  });

  it('counts runs priced from a transcript as estimated', () => {
    const totals = sumUsage([
      usageRow({ costSource: 'estimated', costUsd: 0.1 }),
      usageRow({ costSource: 'cli', costUsd: 0.1 }),
      usageRow({ costSource: 'none', costUsd: null }),
    ]);
    expect(totals.estimatedRuns).toBe(1);
  });
});

describe('usageForTicket', () => {
  it('keeps only runs of that ticket, reviews of it included', () => {
    const rows = [
      usageRow({ ticketId: 't1' }),
      usageRow({ ticketId: 't1', runKind: 'review' }),
      usageRow({ ticketId: 't2' }),
      usageRow({ ticketId: null, goalId: 'g1' }),
    ];
    expect(usageForTicket(rows, 't1')).toHaveLength(2);
  });

  it('still finds runs of a ticket that no longer exists', () => {
    expect(usageForTicket([usageRow({ ticketId: 'deleted' })], 'deleted')).toHaveLength(1);
  });
});

describe('usageForGoalSubtree', () => {
  const goals = [goal('root'), goal('child', 'root'), goal('grandchild', 'child'), goal('other')];

  it('takes runs on the goal, on descendant goals and on tickets linked into the subtree', () => {
    const tickets = [
      ticket('t-in', { goalId: 'grandchild' }),
      ticket('t-out', { goalId: 'other' }),
    ];
    const rows = [
      usageRow({ id: 'a', goalId: 'root' }),
      usageRow({ id: 'b', goalId: 'grandchild' }),
      usageRow({ id: 'c', ticketId: 't-in' }),
      usageRow({ id: 'd', ticketId: 't-out' }),
      usageRow({ id: 'e', goalId: 'other' }),
    ];
    expect(usageForGoalSubtree(rows, goals[0], goals, tickets).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('counts a run once when it sits on both a ticket and its goal', () => {
    const tickets = [ticket('t1', { goalId: 'child' })];
    const rows = [usageRow({ id: 'both', ticketId: 't1', goalId: 'child' })];
    expect(usageForGoalSubtree(rows, goals[0], goals, tickets)).toHaveLength(1);
  });

  it('ignores a run on a deleted ticket unless the row itself names a goal in the subtree', () => {
    const rows = [
      usageRow({ id: 'orphan', ticketId: 'deleted' }),
      usageRow({ id: 'kept', ticketId: 'deleted', goalId: 'child' }),
    ];
    expect(usageForGoalSubtree(rows, goals[0], goals, []).map((r) => r.id)).toEqual(['kept']);
  });

  it('for a leaf goal only sees its own runs', () => {
    const rows = [usageRow({ goalId: 'grandchild' }), usageRow({ goalId: 'child' })];
    expect(usageForGoalSubtree(rows, goals[2], goals, [])).toHaveLength(1);
  });
});

describe('groupUsage', () => {
  const ctx = {
    tickets: [
      ticket('t1', { status: 'done', epicId: 'e1', goalId: 'g1' }),
      ticket('t2', { status: 'open', epicId: 'e2' }),
    ],
    goals: [goal('g1')],
    epics: [
      { id: 'e1', name: 'Epic One' },
      { id: 'e2', name: 'Epic Two' },
    ],
  };

  it('groups by the ticket’s current status and puts unattributed runs in one — group', () => {
    const groups = groupUsage(
      [
        usageRow({ ticketId: 't1', costUsd: 1 }),
        usageRow({ ticketId: 't1', costUsd: 2 }),
        usageRow({ ticketId: 't2', costUsd: 5 }),
        usageRow({ ticketId: null, costUsd: 0.1 }),
        usageRow({ ticketId: 'deleted', costUsd: 0.1 }),
      ],
      'status',
      ctx
    );
    expect(groups.map((g) => [g.label, g.totals.runs, g.totals.costUsd])).toEqual([
      ['open', 1, 5],
      ['done', 2, 3],
      ['—', 2, 0.2],
    ]);
  });

  it('groups by ticket, naming a deleted ticket by its id so its cost history stays visible', () => {
    const groups = groupUsage(
      [
        usageRow({ ticketId: 't1', costUsd: 1 }),
        usageRow({ ticketId: 'deleted', costUsd: 2 }),
        usageRow({ ticketId: null, costUsd: 3 }),
      ],
      'ticket',
      ctx
    );
    expect(groups.map((g) => g.label)).toEqual(['deleted', 'Ticket t1', '—']);
  });

  it('groups by epic name through the ticket', () => {
    const groups = groupUsage(
      [usageRow({ ticketId: 't1', costUsd: 1 }), usageRow({ ticketId: 't2', costUsd: 2 })],
      'epic',
      ctx
    );
    expect(groups.map((g) => g.label)).toEqual(['Epic Two', 'Epic One']);
  });

  it('groups by goal, using the ticket’s goal when the row carries none', () => {
    const groups = groupUsage(
      [
        usageRow({ goalId: 'g1', costUsd: 1 }),
        usageRow({ ticketId: 't1', goalId: null, costUsd: 1 }),
        usageRow({ ticketId: 't2', costUsd: 1 }),
      ],
      'goal',
      ctx
    );
    expect(groups.map((g) => [g.label, g.totals.runs])).toEqual([
      ['Goal g1', 2],
      ['—', 1],
    ]);
  });

  it('groups by provider and by model, a missing model reading as —', () => {
    const rows = [
      usageRow({ provider: 'claude', model: 'm1', costUsd: 2 }),
      usageRow({ provider: 'codex', model: null, costUsd: 1 }),
    ];
    expect(groupUsage(rows, 'provider', ctx).map((g) => g.label)).toEqual(['claude', 'codex']);
    expect(groupUsage(rows, 'model', ctx).map((g) => g.label)).toEqual(['m1', '—']);
  });

  it('groups by UTC day of the finish, oldest day first', () => {
    const groups = groupUsage(
      [
        usageRow({ finishedAt: '2026-09-30T23:59:00Z', costUsd: 9 }),
        usageRow({ finishedAt: '2026-09-29T00:01:00Z', costUsd: 1 }),
        usageRow({ finishedAt: '2026-09-29T12:00:00Z', costUsd: 1 }),
      ],
      'day',
      ctx
    );
    expect(groups.map((g) => [g.key, g.totals.runs])).toEqual([
      ['2026-09-29', 2],
      ['2026-09-30', 1],
    ]);
  });

  it('orders groups with unknown-only cost after priced ones and keeps unknown runs visible', () => {
    const groups = groupUsage(
      [
        usageRow({ provider: 'a', costUsd: null, costSource: 'none' }),
        usageRow({ provider: 'b', costUsd: 0.5 }),
      ],
      'provider',
      ctx
    );
    expect(groups.map((g) => g.label)).toEqual(['b', 'a']);
    expect(groups[1].totals.unknownCostRuns).toBe(1);
  });
});

describe('withinWindow', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const rows = [
    usageRow({ id: 'today', finishedAt: '2026-09-30T08:00:00Z' }),
    usageRow({ id: '6d', finishedAt: '2026-09-24T13:00:00Z' }),
    usageRow({ id: '8d', finishedAt: '2026-09-22T08:00:00Z' }),
    usageRow({ id: '31d', finishedAt: '2026-08-30T08:00:00Z' }),
  ];

  it('7d keeps runs finished within the last seven days', () => {
    expect(withinWindow(rows, '7d', now).map((r) => r.id)).toEqual(['today', '6d']);
  });

  it('30d keeps runs finished within the last thirty days', () => {
    expect(withinWindow(rows, '30d', now).map((r) => r.id)).toEqual(['today', '6d', '8d']);
  });

  it('all keeps everything', () => {
    expect(withinWindow(rows, 'all', now)).toHaveLength(4);
  });

  it('leaves out a run with an unparseable date rather than guessing', () => {
    expect(withinWindow([usageRow({ finishedAt: 'garbage' })], '7d', now)).toHaveLength(0);
  });
});

describe('estimateDeviation', () => {
  it('is null when no row has both a cli cost and an estimate', () => {
    expect(estimateDeviation([])).toBeNull();
    expect(estimateDeviation([usageRow({ costUsd: 1, estimateCostUsd: null })])).toBeNull();
    expect(
      estimateDeviation([usageRow({ costUsd: null, costSource: 'none', estimateCostUsd: 1 })])
    ).toBeNull();
  });

  it('ignores estimated-only rows: their cost is the estimate, so it has no reference', () => {
    expect(
      estimateDeviation([usageRow({ costSource: 'estimated', costUsd: 1, estimateCostUsd: 1 })])
    ).toBeNull();
  });

  it('reports mean, median and max of the absolute percentage deviation', () => {
    const result = estimateDeviation([
      usageRow({ costUsd: 1, estimateCostUsd: 1.1 }),
      usageRow({ costUsd: 2, estimateCostUsd: 1.8 }),
      usageRow({ costUsd: 1, estimateCostUsd: 1.4 }),
    ]);
    expect(result?.n).toBe(3);
    expect(result?.meanAbsPct).toBeCloseTo((10 + 10 + 40) / 3, 6);
    expect(result?.medianAbsPct).toBeCloseTo(10, 6);
    expect(result?.maxAbsPct).toBeCloseTo(40, 6);
  });

  it('takes the mean of the two middle values as the median for an even count', () => {
    const result = estimateDeviation([
      usageRow({ costUsd: 1, estimateCostUsd: 1.1 }),
      usageRow({ costUsd: 1, estimateCostUsd: 1.3 }),
    ]);
    expect(result?.medianAbsPct).toBeCloseTo(20, 6);
  });

  it('leaves out a $0 cli cost, where a percentage is undefined', () => {
    expect(estimateDeviation([usageRow({ costUsd: 0, estimateCostUsd: 0.2 })])).toBeNull();
  });
});
