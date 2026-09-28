import { describe, expect, it } from 'vitest';
import { computeGoalMetrics, type GoalHistoryEntry } from './goalMetrics';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-01T08:00:00Z');

function at(hours: number): string {
  return new Date(T0 + hours * HOUR).toISOString();
}

function entry(
  fromStatus: string | null,
  toStatus: string,
  hours: number,
  source = 'ui'
): GoalHistoryEntry {
  return { goalId: 'g1', fromStatus, toStatus, changedAt: at(hours), source };
}

describe('computeGoalMetrics', () => {
  it('sums the time a goal spent in each status it has left', () => {
    const history = [
      entry(null, 'draft', 0),
      entry('draft', 'active', 2),
      entry('active', 'in_progress', 5),
    ];
    const m = computeGoalMetrics(history, 'in_progress', T0 + 8 * HOUR);
    expect(m.timeInStatus).toEqual({ draft: 2 * HOUR, active: 3 * HOUR });
    expect(m.timeInCurrentStatus).toBe(3 * HOUR);
    expect(m.currentStatusSince).toBe(at(5));
    expect(m.cycleTime).toBeNull();
    expect(m.reviewRounds).toBe(0);
  });

  it('counts every entry into review, so rework shows as extra rounds', () => {
    const history = [
      entry(null, 'active', 0),
      entry('active', 'in_progress', 1),
      entry('in_progress', 'in_review', 4),
      entry('in_review', 'in_progress', 5),
      entry('in_progress', 'in_review', 7),
      entry('in_review', 'achieved', 8),
    ];
    const m = computeGoalMetrics(history, 'achieved', T0 + 9 * HOUR);
    expect(m.reviewRounds).toBe(2);
    expect(m.timeInStatus.in_review).toBe(2 * HOUR);
    expect(m.timeInStatus.in_progress).toBe(5 * HOUR);
  });

  it('measures the cycle from the start of the working spell that ended in achieved', () => {
    const history = [
      entry(null, 'active', 0),
      entry('active', 'in_progress', 1),
      entry('in_progress', 'in_review', 4),
      entry('in_review', 'in_progress', 5),
      entry('in_progress', 'achieved', 7),
    ];
    const m = computeGoalMetrics(history, 'achieved', T0 + 9 * HOUR);
    // Review and rework are part of the same spell, not a restart.
    expect(m.cycleTime).toBe(6 * HOUR);
    expect(m.leadTime).toBe(7 * HOUR);
    expect(m.completedAt).toBe(at(7));
  });

  it('restarts the cycle after the goal left work, e.g. failed and reopened', () => {
    const history = [
      entry(null, 'active', 0),
      entry('active', 'in_progress', 1),
      entry('in_progress', 'failed', 3),
      entry('failed', 'in_progress', 10),
      entry('in_progress', 'achieved', 12),
    ];
    const m = computeGoalMetrics(history, 'achieved', T0 + 20 * HOUR);
    expect(m.cycleTime).toBe(2 * HOUR);
    expect(m.leadTime).toBe(12 * HOUR);
  });

  it('measures a reopened goal to its current completion only', () => {
    const history = [
      entry(null, 'in_progress', 0),
      entry('in_progress', 'achieved', 2),
      entry('achieved', 'in_progress', 3),
    ];
    const m = computeGoalMetrics(history, 'in_progress', T0 + 5 * HOUR);
    expect(m.completedAt).toBeNull();
    expect(m.cycleTime).toBeNull();
  });

  it('says when timing only starts at a backfilled snapshot', () => {
    const history = [entry(null, 'achieved', 0, 'backfill')];
    const m = computeGoalMetrics(history, 'achieved', T0 + HOUR);
    expect(m.trackedSince).toBe(at(0));
    expect(m.backfilled).toBe(true);
    // A snapshot is not a creation nor a working spell.
    expect(m.leadTime).toBeNull();
    expect(m.cycleTime).toBeNull();
  });

  it('reports nothing for a goal without history', () => {
    const m = computeGoalMetrics([], 'draft', T0);
    expect(m.trackedSince).toBeNull();
    expect(m.backfilled).toBe(false);
    expect(m.timeInCurrentStatus).toBeNull();
    expect(m.timeInStatus).toEqual({});
  });

  it('parses the SQLite UTC stamp shape the backend writes', () => {
    const history: GoalHistoryEntry[] = [
      {
        goalId: 'g1',
        fromStatus: null,
        toStatus: 'draft',
        changedAt: '2026-09-01 08:00:00',
        source: 'ui',
      },
    ];
    const m = computeGoalMetrics(history, 'draft', T0 + HOUR);
    expect(m.timeInCurrentStatus).toBe(HOUR);
  });
});
