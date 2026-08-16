import { describe, expect, it } from 'vitest';

import type {
  UsageAggregate,
  UsageNamedAggregate,
  UsageTokenCounts,
  UsageWindowReport,
} from './ccUsage';
import {
  cacheReadShare,
  costPerSession,
  costPerTurn,
  formatCost,
  formatTokens,
  peakBucket,
  projectedMonthlyCost,
  shareOf,
  sidechainShare,
  thinkingShare,
  tokenClasses,
} from './breakdown';

const HOUR = 3600;
const NOW = 1_787_400_000;

function counts(partial: Partial<UsageTokenCounts> = {}): UsageTokenCounts {
  return {
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    thinking: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    ...partial,
  };
}

function aggregate(partial: Partial<UsageAggregate> = {}): UsageAggregate {
  return { counts: counts(), cost: 0, cacheSaving: 0, messages: 0, ...partial };
}

function windowReport(partial: Partial<UsageWindowReport> = {}): UsageWindowReport {
  return {
    id: '24h',
    label: '24 hours',
    hours: 24,
    startsAt: NOW - 24 * HOUR,
    endsAt: NOW,
    bucketSeconds: HOUR,
    totals: aggregate(),
    models: [],
    projects: [],
    buckets: [],
    sessions: 0,
    sidechainMessages: 0,
    unpricedModels: [],
    ...partial,
  };
}

describe('formatCost', () => {
  it('keeps cents visible on everyday amounts', () => {
    expect(formatCost(12.3456, 'USD')).toBe('$12.35');
    expect(formatCost(0.5, 'USD')).toBe('$0.50');
  });

  it('does not round a small but nonzero cost down to nothing', () => {
    // "$0.00" next to a row that clearly did work reads as a bug, so anything
    // that rounds to zero gets the more-precise form instead.
    expect(formatCost(0.004, 'USD')).toBe('$0.004');
    expect(formatCost(0.0004, 'USD')).toBe('<$0.001');
  });

  it('reports a genuine zero as zero', () => {
    expect(formatCost(0, 'USD')).toBe('$0.00');
  });

  it('groups thousands so a four-figure total is readable at a glance', () => {
    expect(formatCost(11442.6, 'USD')).toBe('$11,442.60');
  });

  it('falls back to the code for a currency with no symbol', () => {
    expect(formatCost(5, 'XYZ')).toBe('5.00 XYZ');
  });
});

describe('formatTokens', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatTokens(742)).toBe('742');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(3_150_000)).toBe('3.15M');
    expect(formatTokens(14_496_236_359)).toBe('14.5B');
  });

  it('shows zero as zero rather than as an empty unit', () => {
    expect(formatTokens(0)).toBe('0');
  });
});

describe('tokenClasses', () => {
  it('splits the total into the classes that are priced differently', () => {
    const split = tokenClasses(
      counts({ input: 10, output: 20, cacheWrite5m: 30, cacheWrite1h: 40, cacheRead: 400 })
    );
    expect(split.map((entry) => entry.key)).toEqual([
      'cacheRead',
      'cacheWrite1h',
      'cacheWrite5m',
      'output',
      'input',
    ]);
    // Largest first, because the point of the breakdown is finding what
    // dominates the bill.
    expect(split[0].tokens).toBe(400);
    expect(split.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(500);
  });

  it('leaves out classes that contributed nothing', () => {
    // A row of zeroes is noise in a panel whose job is to show what dominates.
    const split = tokenClasses(counts({ input: 5, output: 5 }));
    expect(split).toHaveLength(2);
  });

  it('never lists thinking as its own class', () => {
    // Thinking is already inside output; a separate class would make the parts
    // add up to more than the whole.
    const split = tokenClasses(counts({ output: 100, thinking: 90 }));
    expect(split).toHaveLength(1);
    expect(split[0].tokens).toBe(100);
  });
});

describe('shares', () => {
  it('reports the cache read share of everything that went in', () => {
    const window = windowReport({
      totals: aggregate({ counts: counts({ input: 100, cacheWrite5m: 100, cacheRead: 800 }) }),
    });
    expect(cacheReadShare(window)).toBeCloseTo(0.8);
  });

  it('reports no cache share when nothing went in at all', () => {
    expect(cacheReadShare(windowReport())).toBe(0);
  });

  it('reports the thinking share of the output', () => {
    const window = windowReport({
      totals: aggregate({ counts: counts({ output: 1000, thinking: 250 }) }),
    });
    expect(thinkingShare(window)).toBeCloseTo(0.25);
  });

  it('reports the sidechain share of the turns', () => {
    const window = windowReport({
      totals: aggregate({ messages: 200 }),
      sidechainMessages: 50,
    });
    expect(sidechainShare(window)).toBeCloseTo(0.25);
  });

  it('treats an empty window as zero rather than dividing by nothing', () => {
    const empty = windowReport();
    expect(thinkingShare(empty)).toBe(0);
    expect(sidechainShare(empty)).toBe(0);
    expect(costPerTurn(empty)).toBe(0);
    expect(costPerSession(empty)).toBe(0);
  });

  it('gives a row its share of the window total', () => {
    const row: UsageNamedAggregate = {
      key: 'claude-opus-5',
      label: 'Opus 5',
      aggregate: aggregate({ cost: 25 }),
      sessions: 1,
      unpriced: false,
    };
    expect(shareOf(row, 100)).toBeCloseTo(0.25);
    // A window with no cost cannot apportion one — including the all-unpriced
    // case, where every row's cost is zero.
    expect(shareOf(row, 0)).toBe(0);
  });
});

describe('averages', () => {
  it('divides cost by turns and by sessions', () => {
    const window = windowReport({
      totals: aggregate({ cost: 100, messages: 40 }),
      sessions: 8,
    });
    expect(costPerTurn(window)).toBeCloseTo(2.5);
    expect(costPerSession(window)).toBeCloseTo(12.5);
  });
});

describe('projectedMonthlyCost', () => {
  it('extrapolates a window to thirty days', () => {
    const day = windowReport({ hours: 24, totals: aggregate({ cost: 10 }) });
    expect(projectedMonthlyCost(day)).toBeCloseTo(300);
  });

  it('does not extrapolate a window that is already a month', () => {
    // Projecting the 30-day window would restate a measurement as a forecast.
    const month = windowReport({ id: '30d', hours: 720, totals: aggregate({ cost: 300 }) });
    expect(projectedMonthlyCost(month)).toBeNull();
  });

  it('declines to project from an empty window', () => {
    // Zero times anything is zero, and "$0.00 projected" is a claim about the
    // future that a quiet day cannot support.
    expect(projectedMonthlyCost(windowReport({ hours: 24 }))).toBeNull();
  });
});

describe('peakBucket', () => {
  it('finds the costliest bucket', () => {
    const window = windowReport({
      buckets: [
        { startsAt: NOW - 3 * HOUR, cost: 1, tokens: 10, messages: 1 },
        { startsAt: NOW - 2 * HOUR, cost: 9, tokens: 90, messages: 5 },
        { startsAt: NOW - HOUR, cost: 4, tokens: 40, messages: 2 },
      ],
    });
    expect(peakBucket(window)?.startsAt).toBe(NOW - 2 * HOUR);
  });

  it('has no peak when nothing happened', () => {
    // Every bucket is present even when idle, so "the first bucket" would
    // otherwise be reported as a peak of zero.
    const window = windowReport({
      buckets: [
        { startsAt: NOW - 2 * HOUR, cost: 0, tokens: 0, messages: 0 },
        { startsAt: NOW - HOUR, cost: 0, tokens: 0, messages: 0 },
      ],
    });
    expect(peakBucket(window)).toBeNull();
  });

  it('has no peak in a window with no buckets at all', () => {
    expect(peakBucket(windowReport())).toBeNull();
  });
});
