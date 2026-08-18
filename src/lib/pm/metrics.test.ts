// Day arithmetic only misbehaves in a zone that observes DST, so pinning one
// is what makes the DST test below able to fail at all. Under the runner's
// default (usually UTC) the broken walk is accidentally correct.
process.env.TZ = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import {
  computeBurndown,
  computeEpicProjections,
  computeProjectProjection,
  computeStatusDurations,
  computeTicketMetrics,
  computeVelocity,
  computeVelocityBasis,
  formatDuration,
  parseHistoryTime,
} from './metrics';

const DAY = 24 * 60 * 60 * 1000;

describe('metrics', () => {
  describe('formatDuration', () => {
    it('returns "< 1m" for durations under 60 seconds', () => {
      expect(formatDuration(0)).toBe('< 1m');
      expect(formatDuration(30_000)).toBe('< 1m');
      expect(formatDuration(59_999)).toBe('< 1m');
    });

    it('returns minutes for durations under 60 minutes', () => {
      expect(formatDuration(60_000)).toBe('1m');
      expect(formatDuration(5 * 60_000)).toBe('5m');
      expect(formatDuration(59 * 60_000 + 59_999)).toBe('59m');
    });

    it('returns hours and minutes for durations under 24 hours', () => {
      expect(formatDuration(60 * 60_000)).toBe('1h 0m');
      expect(formatDuration(2 * 60 * 60_000 + 15 * 60_000)).toBe('2h 15m');
      expect(formatDuration(23 * 60 * 60_000 + 59 * 60_000)).toBe('23h 59m');
    });

    it('returns days and hours for durations >= 24 hours', () => {
      expect(formatDuration(24 * 60 * 60_000)).toBe('1d 0h');
      expect(formatDuration(24 * 60 * 60_000 + 4 * 60 * 60_000)).toBe('1d 4h');
      expect(formatDuration(7 * 24 * 60 * 60_000 + 12 * 60 * 60_000)).toBe('7d 12h');
    });
  });

  describe('computeTicketMetrics', () => {
    it('computes cycle time and lead time for a completed ticket', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-04T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];

      const result = computeTicketMetrics(history, tickets);

      expect(result).toHaveLength(1);
      // Cycle time: Jan 2 -> Jan 4 = 2 days = 172800000ms
      expect(result[0].cycleTime).toBe(2 * 24 * 60 * 60 * 1000);
      // Lead time: Jan 1 -> Jan 4 = 3 days = 259200000ms
      expect(result[0].leadTime).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('returns null for tickets not yet done', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'in_progress' }];

      const result = computeTicketMetrics(history, tickets);

      expect(result).toHaveLength(1);
      expect(result[0].cycleTime).toBeNull();
      expect(result[0].leadTime).toBeNull();
    });

    it('returns null cycle time when ticket went directly from open to done', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];

      const result = computeTicketMetrics(history, tickets);

      expect(result).toHaveLength(1);
      // No in_progress event, so cycle time is null
      expect(result[0].cycleTime).toBeNull();
      // Lead time: Jan 1 -> Jan 3 = 2 days
      expect(result[0].leadTime).toBe(2 * 24 * 60 * 60 * 1000);
    });

    it('handles multiple tickets', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'open' },
      ];

      const result = computeTicketMetrics(history, tickets);

      expect(result).toHaveLength(2);
      const t1 = result.find((r) => r.ticketId === 't1')!;
      const t2 = result.find((r) => r.ticketId === 't2')!;
      expect(t1.cycleTime).toBe(1 * 24 * 60 * 60 * 1000);
      expect(t1.leadTime).toBe(2 * 24 * 60 * 60 * 1000);
      expect(t2.cycleTime).toBeNull();
      expect(t2.leadTime).toBeNull();
    });
  });

  describe('computeVelocity', () => {
    it('counts tickets completed per weekly period', () => {
      const history = [
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't2',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
        {
          ticketId: 't3',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-10T00:00:00Z',
        },
      ];
      const tickets = [
        { id: 't1', status: 'done', epicId: 'e1' },
        { id: 't2', status: 'done', epicId: 'e1' },
        { id: 't3', status: 'done', epicId: 'e1' },
      ];

      const result = computeVelocity(history, tickets, 7);

      expect(result.length).toBeGreaterThanOrEqual(2);
      // First period should have 2 completions
      const firstPeriod = result[0];
      expect(firstPeriod.completed).toBe(2);
      // Second period should have 1 completion
      const secondPeriod = result[1];
      expect(secondPeriod.completed).toBe(1);
    });

    it('returns empty array when no completions', () => {
      const history = [
        {
          ticketId: 't1',
          fromStatus: null,
          toStatus: 'open',
          changedAt: '2026-01-01T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', status: 'open', epicId: 'e1' }];

      const result = computeVelocity(history, tickets);
      expect(result).toEqual([]);
    });

    it('handles custom period length', () => {
      const history = [
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-01T00:00:00Z',
        },
        {
          ticketId: 't2',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-15T00:00:00Z',
        },
      ];
      const tickets = [
        { id: 't1', status: 'done', epicId: 'e1' },
        { id: 't2', status: 'done', epicId: 'e1' },
      ];

      const result = computeVelocity(history, tickets, 14);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].completed).toBe(1);
    });
  });

  describe('computeBurndown', () => {
    it('computes daily remaining vs completed', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't2',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'done' },
        { id: 't3', epicId: 'e1', status: 'open' },
      ];

      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-03T12:00:00Z'),
      });

      expect(result.length).toBeGreaterThanOrEqual(3);
      // First day: 3 remaining, 0 completed
      expect(result[0].remaining).toBe(3);
      expect(result[0].completed).toBe(0);
      // Second day: 2 remaining, 1 completed
      expect(result[1].remaining).toBe(2);
      expect(result[1].completed).toBe(1);
      // Third day: 1 remaining, 2 completed
      expect(result[2].remaining).toBe(1);
      expect(result[2].completed).toBe(2);
    });

    it('limits results with the trailingDays option', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't2',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'done' },
      ];

      const result = computeBurndown(history, tickets, {
        trailingDays: 2,
        now: Date.parse('2026-01-03T12:00:00Z'),
      });

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no history', () => {
      const result = computeBurndown([], []);
      expect(result).toEqual([]);
    });
  });

  describe('parseHistoryTime', () => {
    it('reads a SQLite datetime as UTC, not as local time', () => {
      // `datetime('now')` writes 'YYYY-MM-DD HH:MM:SS' in UTC, but JS parses
      // that shape as local time. Anything measured against Date.now() would
      // be wrong by the machine's offset.
      expect(parseHistoryTime('2026-01-02 03:04:05')).toBe(Date.parse('2026-01-02T03:04:05Z'));
    });

    it('accepts ISO timestamps unchanged', () => {
      expect(parseHistoryTime('2026-01-02T03:04:05Z')).toBe(Date.parse('2026-01-02T03:04:05Z'));
      expect(parseHistoryTime('2026-01-02T03:04:05.500Z')).toBe(
        Date.parse('2026-01-02T03:04:05.500Z')
      );
    });
  });

  describe('computeTicketMetrics — completion, time in state', () => {
    it('treats archived as a completion, exactly like done', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'archived',
          changedAt: '2026-01-04T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'archived' }];

      const [m] = computeTicketMetrics(history, tickets);

      expect(m.cycleTime).toBe(2 * DAY);
      expect(m.leadTime).toBe(3 * DAY);
      expect(m.completedAt).toBe('2026-01-04T00:00:00Z');
    });

    it('does not treat discarded as a completion', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'discarded',
          changedAt: '2026-01-02T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'discarded' }];

      const [m] = computeTicketMetrics(history, tickets);

      expect(m.cycleTime).toBeNull();
      expect(m.leadTime).toBeNull();
      expect(m.completedAt).toBeNull();
    });

    it('never reports a negative cycle time when a ticket is reopened', () => {
      // open -> done -> open -> in_progress -> done. Pairing the FIRST
      // in_progress with the FIRST done would run backwards in time.
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't1', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-02T00:00:00Z' },
        { ticketId: 't1', fromStatus: 'done', toStatus: 'open', changedAt: '2026-01-03T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-04T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-06T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];

      const [m] = computeTicketMetrics(history, tickets);

      expect(m.cycleTime).toBe(2 * DAY);
      expect(m.leadTime).toBe(5 * DAY);
    });

    it('measures the working spell that finished the ticket, not the first one', () => {
      // Worked Jan 2-3, reopened, worked again Jan 5-7. Reaching back to the
      // first in_progress would bill the reopened idle days as working time.
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-03T00:00:00Z',
        },
        { ticketId: 't1', fromStatus: 'done', toStatus: 'open', changedAt: '2026-01-04T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-05T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-07T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];

      const [m] = computeTicketMetrics(history, tickets);

      expect(m.cycleTime).toBe(2 * DAY);
      expect(m.completedAt).toBe('2026-01-07T00:00:00Z');
    });

    it('accumulates the time a ticket spent in each status', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-03T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'in_review',
          changedAt: '2026-01-04T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_review',
          toStatus: 'in_progress',
          changedAt: '2026-01-05T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];

      const [m] = computeTicketMetrics(history, tickets);

      expect(m.timeInStatus.open).toBe(2 * DAY);
      // Two separate visits, added up.
      expect(m.timeInStatus.in_progress).toBe(4 * DAY);
      expect(m.timeInStatus.in_review).toBe(1 * DAY);
      // The final status is still running, so it is reported separately.
      expect(m.timeInStatus.done).toBeUndefined();
    });

    it('reports how long an unfinished ticket has been sitting where it is', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-02T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'in_progress' }];

      const [m] = computeTicketMetrics(history, tickets, Date.parse('2026-01-05T00:00:00Z'));

      expect(m.currentStatus).toBe('in_progress');
      expect(m.timeInCurrentStatus).toBe(3 * DAY);
      expect(m.timeInStatus.open).toBe(1 * DAY);
    });

    it('measures a SQLite timestamp against now without a timezone shift', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01 00:00:00' },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'open' }];

      const [m] = computeTicketMetrics(history, tickets, Date.parse('2026-01-02T00:00:00Z'));

      expect(m.timeInCurrentStatus).toBe(1 * DAY);
    });
  });

  describe('computeStatusDurations', () => {
    it('aggregates time in state across tickets', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-03T00:00:00Z',
        },
        {
          ticketId: 't1',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-04T00:00:00Z',
        },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't2',
          fromStatus: 'open',
          toStatus: 'in_progress',
          changedAt: '2026-01-05T00:00:00Z',
        },
        {
          ticketId: 't2',
          fromStatus: 'in_progress',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'done' },
      ];

      const result = computeStatusDurations(history, tickets);
      const open = result.find((r) => r.status === 'open')!;
      const inProgress = result.find((r) => r.status === 'in_progress')!;

      expect(open.ticketCount).toBe(2);
      expect(open.averageMs).toBe(3 * DAY); // (2d + 4d) / 2
      expect(open.medianMs).toBe(3 * DAY);
      expect(inProgress.ticketCount).toBe(2);
      expect(inProgress.averageMs).toBe(2 * DAY); // (1d + 3d) / 2
    });

    it('returns nothing when no status was ever left', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'open' }];

      expect(computeStatusDurations(history, tickets)).toEqual([]);
    });
  });

  describe('computeVelocityBasis', () => {
    const history = [
      { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't4', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't1', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-02T00:00:00Z' },
      { ticketId: 't2', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-04T00:00:00Z' },
      { ticketId: 't3', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-06T00:00:00Z' },
      { ticketId: 't4', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-08T00:00:00Z' },
    ];
    const tickets = [
      { id: 't1', epicId: 'e1', status: 'done' },
      { id: 't2', epicId: 'e1', status: 'done' },
      { id: 't3', epicId: 'e1', status: 'done' },
      { id: 't4', epicId: 'e1', status: 'done' },
    ];

    it('derives throughput from every completion when no window is given', () => {
      const basis = computeVelocityBasis(history, tickets);

      expect(basis.sampleSize).toBe(4);
      // Three intervals across six days.
      expect(basis.ticketsPerDay).toBeCloseTo(3 / 6);
      expect(basis.spanMs).toBe(6 * DAY);
    });

    it('narrows the basis to the last N completed tickets', () => {
      const basis = computeVelocityBasis(history, tickets, 2);

      expect(basis.sampleSize).toBe(2);
      expect(basis.from).toBe('2026-01-06T00:00:00Z');
      expect(basis.to).toBe('2026-01-08T00:00:00Z');
      // One interval across two days.
      expect(basis.ticketsPerDay).toBeCloseTo(1 / 2);
    });

    it('counts a ticket once, however often it was marked done', () => {
      const noisy = [
        ...history,
        { ticketId: 't1', fromStatus: 'done', toStatus: 'open', changedAt: '2026-01-03T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'archived',
          changedAt: '2026-01-09T00:00:00Z',
        },
      ];

      const basis = computeVelocityBasis(noisy, tickets);

      // Still four tickets, not six events.
      expect(basis.sampleSize).toBe(4);
      // t1's completion is its LAST one, so it now closes the window.
      expect(basis.to).toBe('2026-01-09T00:00:00Z');
    });

    it('drops a completion that was taken back', () => {
      // t1 was marked done, then reopened and is still open. Counting that
      // event would credit the project with work it does not have.
      const reopened = [
        { ticketId: 't5', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't5', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-03T00:00:00Z' },
        { ticketId: 't5', fromStatus: 'done', toStatus: 'open', changedAt: '2026-01-05T00:00:00Z' },
      ];
      const withOpen = [...tickets, { id: 't5', epicId: 'e1', status: 'open' }];

      const basis = computeVelocityBasis([...history, ...reopened], withOpen);

      expect(basis.sampleSize).toBe(4);
      expect(basis.to).toBe('2026-01-08T00:00:00Z');
    });

    it('reports no throughput when a single ticket cannot span an interval', () => {
      const basis = computeVelocityBasis(history, tickets, 1);

      expect(basis.sampleSize).toBe(1);
      expect(basis.ticketsPerDay).toBe(0);
    });

    it('averages cycle and lead time over exactly the sampled tickets', () => {
      const basis = computeVelocityBasis(history, tickets, 2);

      // t3 and t4 both ran open -> done, so there is no cycle time to average.
      expect(basis.avgCycleTime).toBeNull();
      expect(basis.avgLeadTime).toBe(6 * DAY); // (5d + 7d) / 2
    });
  });

  describe('computeEpicProjections — driven by a basis', () => {
    const history = [
      { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't1', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-02T00:00:00Z' },
      { ticketId: 't2', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-04T00:00:00Z' },
    ];
    const tickets = [
      { id: 't1', epicId: 'e1', status: 'done' },
      { id: 't2', epicId: 'e1', status: 'done' },
      { id: 't3', epicId: 'e1', status: 'open' },
    ];
    const epics = [{ id: 'e1', name: 'Epic One' }];

    it('estimates from the supplied basis rather than from raw events', () => {
      const basis = computeVelocityBasis(history, tickets);
      // One interval across two days -> 0.5 tickets/day -> 1 remaining -> 2 days.
      const [p] = computeEpicProjections(history, tickets, epics, basis);

      expect(p.remainingTickets).toBe(1);
      expect(p.estimatedDaysRemaining).toBe(2);
    });

    it('does not count discarded tickets as remaining work', () => {
      const withDiscarded = [...tickets, { id: 't4', epicId: 'e1', status: 'discarded' as const }];
      const basis = computeVelocityBasis(history, withDiscarded);
      const [p] = computeEpicProjections(history, withDiscarded, epics, basis);

      expect(p.remainingTickets).toBe(1);
    });

    it('does not let a reopened ticket inflate the estimate', () => {
      const noisy = [
        ...history,
        { ticketId: 't1', fromStatus: 'done', toStatus: 'open', changedAt: '2026-01-03T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'archived',
          changedAt: '2026-01-04T00:00:00Z',
        },
      ];
      const basis = computeVelocityBasis(noisy, tickets);

      // Two tickets completed, not four events.
      expect(basis.sampleSize).toBe(2);
    });

    it('projects a completion date when a reference point is given', () => {
      const basis = computeVelocityBasis(history, tickets);
      const [p] = computeEpicProjections(
        history,
        tickets,
        epics,
        basis,
        Date.parse('2026-01-10T00:00:00Z')
      );

      expect(p.estimatedCompletionDate).toBe('2026-01-12');
    });
  });

  describe('computeProjectProjection', () => {
    it('estimates the whole project from one basis', () => {
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e2', status: 'archived' },
        { id: 't3', epicId: 'e1', status: 'open' },
        { id: 't4', epicId: 'e2', status: 'in_progress' },
      ];
      const basis = {
        sampleSize: 2,
        ticketsPerDay: 0.5,
        spanMs: 2 * DAY,
        avgCycleTime: null,
        avgLeadTime: null,
        from: null,
        to: null,
      };

      const p = computeProjectProjection(tickets, basis, Date.parse('2026-01-10T00:00:00Z'));

      expect(p.totalTickets).toBe(4);
      expect(p.completedTickets).toBe(2);
      expect(p.remainingTickets).toBe(2);
      expect(p.estimatedDaysRemaining).toBe(4);
      expect(p.estimatedCompletionDate).toBe('2026-01-14');
    });

    it('withholds an estimate when throughput is unknown', () => {
      const tickets = [{ id: 't1', epicId: 'e1', status: 'open' }];
      const basis = {
        sampleSize: 0,
        ticketsPerDay: 0,
        spanMs: 0,
        avgCycleTime: null,
        avgLeadTime: null,
        from: null,
        to: null,
      };

      const p = computeProjectProjection(tickets, basis, Date.parse('2026-01-10T00:00:00Z'));

      expect(p.estimatedDaysRemaining).toBeNull();
      expect(p.estimatedCompletionDate).toBeNull();
    });
  });

  describe('computeBurndown — days, scope and forecast', () => {
    const history = [
      { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      { ticketId: 't1', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-02T00:00:00Z' },
      // Scope grows: a third ticket only appears on day three.
      { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-03T00:00:00Z' },
    ];
    const tickets = [
      { id: 't1', epicId: 'e1', status: 'done' },
      { id: 't2', epicId: 'e1', status: 'open' },
      { id: 't3', epicId: 'e1', status: 'open' },
    ];

    it('counts only the tickets that existed on each day', () => {
      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-03T12:00:00Z'),
      });

      expect(result[0]).toMatchObject({ date: '2026-01-01', scope: 2, remaining: 2, completed: 0 });
      expect(result[1]).toMatchObject({ date: '2026-01-02', scope: 2, remaining: 1, completed: 1 });
      expect(result[2]).toMatchObject({ date: '2026-01-03', scope: 3, remaining: 2, completed: 1 });
    });

    it('runs the line up to today even when nothing changed since', () => {
      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-06T12:00:00Z'),
      });

      expect(result.at(-1)!.date).toBe('2026-01-06');
      expect(result.at(-1)!.remaining).toBe(2);
    });

    it('crosses a DST boundary without dropping or repeating a day', () => {
      // Walking days by `setDate` moves in local time, so at a switch it
      // advances 23 hours instead of 24 and from then on labels every day one
      // short — which is how the last day fell off the chart entirely.
      expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).toBe(-120);

      const dstHistory = [
        { ticketId: 'a', fromStatus: null, toStatus: 'open', changedAt: '2026-03-01T00:00:00Z' },
      ];
      const dstTickets = [{ id: 'a', epicId: 'e1', status: 'open' }];

      const result = computeBurndown(dstHistory, dstTickets, {
        // Spans the US switch (Mar 8) as well as the EU one (Mar 29).
        now: Date.parse('2026-04-05T12:00:00Z'),
      });

      const dates = result.map((r) => r.date);
      expect(dates).toHaveLength(36);
      expect(dates[0]).toBe('2026-03-01');
      expect(dates.at(-1)).toBe('2026-04-05');
      expect(new Set(dates).size).toBe(dates.length);
      dates.forEach((date, i) => {
        expect(date).toBe(
          new Date(Date.parse('2026-03-01T00:00:00Z') + i * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        );
      });
    });

    it('counts every completion, including one made today', () => {
      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-03T12:00:00Z'),
      });

      const totalCompleted = result.at(-1)!.completed;
      expect(totalCompleted).toBe(1);
    });

    it('extends a forecast past today from the given throughput', () => {
      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-03T12:00:00Z'),
        throughputPerDay: 1,
        forecastDays: 3,
      });

      const today = result.find((r) => r.date === '2026-01-03')!;
      // The forecast starts where the real line is, so the two meet.
      expect(today.forecast).toBe(2);
      expect(today.remaining).toBe(2);

      const future = result.filter((r) => r.date > '2026-01-03');
      // Stops on the day it lands rather than trailing zeroes across the axis.
      expect(future.map((r) => r.date)).toEqual(['2026-01-04', '2026-01-05']);
      expect(future.map((r) => r.forecast)).toEqual([1, 0]);
      // Nothing is known about the future, so nothing is claimed.
      expect(future.every((r) => r.remaining === null)).toBe(true);
    });

    it('adds no forecast when throughput is unknown', () => {
      const result = computeBurndown(history, tickets, {
        now: Date.parse('2026-01-03T12:00:00Z'),
        throughputPerDay: 0,
        forecastDays: 3,
      });

      expect(result.at(-1)!.date).toBe('2026-01-03');
      expect(result.every((r) => r.forecast === null)).toBe(true);
    });
  });

  describe('computeEpicProjections', () => {
    it('computes projections for epics', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't2',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
        { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'done' },
        { id: 't3', epicId: 'e1', status: 'open' },
      ];
      const epics = [{ id: 'e1', name: 'Epic One' }];

      const result = computeEpicProjections(history, tickets, epics);

      expect(result).toHaveLength(1);
      expect(result[0].epicId).toBe('e1');
      expect(result[0].epicName).toBe('Epic One');
      expect(result[0].totalTickets).toBe(3);
      expect(result[0].completedTickets).toBe(2);
      expect(result[0].avgVelocity).toBeGreaterThan(0);
      expect(result[0].estimatedDaysRemaining).not.toBeNull();
      expect(result[0].estimatedDaysRemaining).toBeGreaterThan(0);
    });

    it('floors the measuring window at one day so a burst cannot run away', () => {
      // Clearing a backlog in one go is not throughput. Measured on the raw
      // span these two would read as an unbounded rate and project everything
      // left to land within the hour.
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't3', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        { ticketId: 't1', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-08T00:00:00Z' },
        { ticketId: 't2', fromStatus: 'open', toStatus: 'done', changedAt: '2026-01-08T00:00:00Z' },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e1', status: 'done' },
        { id: 't3', epicId: 'e1', status: 'open' },
      ];

      const basis = computeVelocityBasis(history, tickets);

      expect(basis.spanMs).toBe(0);
      expect(basis.ticketsPerDay).toBe(1);

      const [p] = computeEpicProjections(history, tickets, [{ id: 'e1', name: 'Epic One' }], basis);
      expect(p.estimatedDaysRemaining).toBe(1);
    });

    it('returns null estimatedDaysRemaining when no velocity data', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'open' }];
      const epics = [{ id: 'e1', name: 'Epic One' }];

      const result = computeEpicProjections(history, tickets, epics);

      expect(result).toHaveLength(1);
      expect(result[0].completedTickets).toBe(0);
      expect(result[0].avgVelocity).toBe(0);
      expect(result[0].estimatedDaysRemaining).toBeNull();
    });

    it('handles multiple epics', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
        { ticketId: 't2', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
      ];
      const tickets = [
        { id: 't1', epicId: 'e1', status: 'done' },
        { id: 't2', epicId: 'e2', status: 'open' },
      ];
      const epics = [
        { id: 'e1', name: 'Epic One' },
        { id: 'e2', name: 'Epic Two' },
      ];

      const result = computeEpicProjections(history, tickets, epics);

      expect(result).toHaveLength(2);
      const e1 = result.find((r) => r.epicId === 'e1')!;
      const e2 = result.find((r) => r.epicId === 'e2')!;
      expect(e1.totalTickets).toBe(1);
      expect(e1.completedTickets).toBe(1);
      expect(e2.totalTickets).toBe(1);
      expect(e2.completedTickets).toBe(0);
    });

    it('returns zero estimatedDaysRemaining when all tickets are done', () => {
      const history = [
        { ticketId: 't1', fromStatus: null, toStatus: 'open', changedAt: '2026-01-01T00:00:00Z' },
        {
          ticketId: 't1',
          fromStatus: 'open',
          toStatus: 'done',
          changedAt: '2026-01-08T00:00:00Z',
        },
      ];
      const tickets = [{ id: 't1', epicId: 'e1', status: 'done' }];
      const epics = [{ id: 'e1', name: 'Epic One' }];

      const result = computeEpicProjections(history, tickets, epics);

      expect(result[0].estimatedDaysRemaining).toBe(0);
    });
  });
});
