import type { TicketStatus } from '@/lib/pm/enums';
import type { InboxItem } from '@/lib/tauri/inbox';

export interface DailyGoalProgress {
  total: number;
  done: number;
  percent: number;
}

/** Whether an inbox item is marked as today's sprint goal / Tagesziel. */
export function isDailyGoal(item: InboxItem): boolean {
  return Boolean(item.dailyGoal);
}

/** Active (non-dismissed) inbox items marked as daily goals. */
export function filterDailyGoals(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => item.dismissedAt === null && isDailyGoal(item));
}

/**
 * Calculates progress for daily sprint goals:
 * how many of them have been marked as 'done'.
 */
export function calculateDailyGoalsProgress(
  goals: Array<{ ticketStatus?: TicketStatus | 'unknown' }>
): DailyGoalProgress {
  const total = goals.length;
  if (total === 0) return { total: 0, done: 0, percent: 0 };
  const done = goals.filter((g) => g.ticketStatus === 'done').length;
  const percent = Math.round((done / total) * 100);
  return { total, done, percent };
}

/**
 * Returns the active daily goal for a specific project path, or undefined if none.
 */
export function getProjectDailyGoal(
  items: InboxItem[],
  projectPath: string
): InboxItem | undefined {
  return filterDailyGoals(items).find((item) => item.projectPath === projectPath);
}

/**
 * Enforces the rule: exactly 1 mini-sprint-goal per project for the day.
 * When setting `targetId` as the daily goal for `projectPath`, returns any other
 * daily goals for the same project that should be unflagged.
 */
export function itemsToUnflagForProject(
  items: InboxItem[],
  targetId: string,
  projectPath: string | null
): InboxItem[] {
  if (projectPath === null) return [];
  return filterDailyGoals(items).filter(
    (item) => item.id !== targetId && item.projectPath === projectPath
  );
}
