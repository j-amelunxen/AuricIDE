import type { GoalStatusValue, Priority, TicketStatus } from './enums';

/** A ticket status in words, for pickers, menus and timing rows. Chips use the short `TICKET_STATUS_LABEL`. */
export const TICKET_STATUS_NAME: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  to_test: 'To test',
  in_review: 'In review',
  done: 'Done',
  archived: 'Archived',
  discarded: 'Discarded',
};

export const GOAL_STATUS_NAME: Record<GoalStatusValue, string> = {
  draft: 'Draft',
  active: 'Active',
  in_progress: 'In progress',
  in_review: 'In review',
  achieved: 'Achieved',
  failed: 'Failed',
  archived: 'Archived',
};

export const PRIORITY_NAME: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

/**
 * Any stored ticket or goal status in words. A value neither list knows (an
 * older row, a history `null` mapped by the caller) reads as its own words.
 */
export function statusName(status: string): string {
  const known =
    (TICKET_STATUS_NAME as Record<string, string>)[status] ??
    (GOAL_STATUS_NAME as Record<string, string>)[status];
  if (known) return known;
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
