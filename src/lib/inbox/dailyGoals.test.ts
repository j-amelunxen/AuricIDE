import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@/lib/tauri/inbox';
import {
  calculateDailyGoalsProgress,
  filterDailyGoals,
  getProjectDailyGoal,
  isDailyGoal,
  itemsToUnflagForProject,
} from './dailyGoals';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Test Task',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    dailyGoal: false,
    ...overrides,
  };
}

describe('dailyGoals', () => {
  describe('isDailyGoal', () => {
    it('returns true when dailyGoal is true', () => {
      expect(isDailyGoal(makeItem({ dailyGoal: true }))).toBe(true);
    });

    it('returns false when dailyGoal is false or undefined', () => {
      expect(isDailyGoal(makeItem({ dailyGoal: false }))).toBe(false);
      expect(isDailyGoal(makeItem({ dailyGoal: undefined }))).toBe(false);
    });
  });

  describe('filterDailyGoals', () => {
    it('filters out non-daily-goal items and dismissed items', () => {
      const g1 = makeItem({ id: 'g1', dailyGoal: true });
      const g2 = makeItem({ id: 'g2', dailyGoal: true, dismissedAt: '2026-09-08T11:00:00Z' });
      const reg = makeItem({ id: 'r1', dailyGoal: false });

      const result = filterDailyGoals([g1, g2, reg]);
      expect(result).toEqual([g1]);
    });
  });

  describe('calculateDailyGoalsProgress', () => {
    it('handles empty list', () => {
      expect(calculateDailyGoalsProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
    });

    it('calculates completed fraction and percentage correctly', () => {
      const items = [
        { ticketStatus: 'done' as const },
        { ticketStatus: 'in_progress' as const },
        { ticketStatus: 'open' as const },
        { ticketStatus: 'done' as const },
      ];
      expect(calculateDailyGoalsProgress(items)).toEqual({
        total: 4,
        done: 2,
        percent: 50,
      });
    });
  });

  describe('getProjectDailyGoal', () => {
    it('finds the active daily goal for the given project path', () => {
      const itemA = makeItem({ id: 'a', projectPath: '/path/a', dailyGoal: true });
      const itemB = makeItem({ id: 'b', projectPath: '/path/b', dailyGoal: true });
      const itemARegular = makeItem({ id: 'a-reg', projectPath: '/path/a', dailyGoal: false });

      expect(getProjectDailyGoal([itemA, itemB, itemARegular], '/path/a')).toEqual(itemA);
      expect(getProjectDailyGoal([itemA, itemB], '/path/c')).toBeUndefined();
    });
  });

  describe('itemsToUnflagForProject', () => {
    it('returns other daily goals for the same project to enforce 1 goal per project', () => {
      const oldGoal = makeItem({ id: 'old-goal', projectPath: '/path/a', dailyGoal: true });
      const newGoal = makeItem({ id: 'new-goal', projectPath: '/path/a', dailyGoal: true });
      const otherProjectGoal = makeItem({ id: 'other', projectPath: '/path/b', dailyGoal: true });

      const unflagList = itemsToUnflagForProject(
        [oldGoal, newGoal, otherProjectGoal],
        'new-goal',
        '/path/a'
      );
      expect(unflagList).toEqual([oldGoal]);
    });

    it('does not unflag when projectPath is null (unsorted tasks)', () => {
      const unsorted1 = makeItem({ id: 'u1', projectPath: null, dailyGoal: true });
      const unsorted2 = makeItem({ id: 'u2', projectPath: null, dailyGoal: true });

      const unflagList = itemsToUnflagForProject([unsorted1, unsorted2], 'u2', null);
      expect(unflagList).toEqual([]);
    });
  });
});
