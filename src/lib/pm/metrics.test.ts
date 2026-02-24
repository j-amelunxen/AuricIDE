import { describe, expect, it } from 'vitest';
import {
  computeBurndown,
  computeEpicProjections,
  computeTicketMetrics,
  computeVelocity,
  formatDuration,
} from './metrics';

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

      const result = computeVelocity(history, 7);

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

      const result = computeVelocity(history);
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

      const result = computeVelocity(history, 14);

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

      const result = computeBurndown(history, tickets);

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

    it('limits results with lastN parameter', () => {
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

      const result = computeBurndown(history, tickets, 2);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no history', () => {
      const result = computeBurndown([], []);
      expect(result).toEqual([]);
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
