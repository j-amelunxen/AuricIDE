import type { Schedule } from '@/lib/tauri/schedules';
import { parseNotificationTimestamp } from './format';
import type { Notification } from './types';

/**
 * What the sidebar tray shows of an inbox that is usually longer than it.
 *
 * The tray is a glance, not a list: three recent rows, a line saying what it
 * left out, and one line about what fires next. Everything here is pure, so
 * the rules about what may and may not fall out of view are checkable without
 * a store or a render.
 */

/** How many ordinary rows the tray keeps. Small on purpose — it is a glance. */
export const TRAY_SIZE = 3;

export interface TraySelection {
  /** Unanswered questions, all of them, in the order they arrived. */
  pinned: Notification[];
  /** The newest ordinary rows, read or unread. */
  latest: Notification[];
  /** How many rows the tray is not showing. */
  hidden: number;
  /** How many of those are unread — the tray says so rather than implying it. */
  hiddenUnread: number;
}

/**
 * Splits an inbox into what the tray shows and what it admits to hiding.
 *
 * Two rules do the work. **An unanswered question never rotates out**: it is a
 * debt someone is waiting on, and age does not settle it, so questions get
 * their own uncapped list rather than competing for the three slots. Everything
 * else is ordinary history, and history rotates — an old unread row falls out
 * exactly like a read one, because "unread" is not the same as "still needed".
 *
 * `notifications` is expected newest-first, the order the store keeps; slicing
 * preserves it. The hidden counts exist so the truncation can be announced —
 * a tray that quietly drops rows teaches you to distrust what it does show.
 */
export function selectTray(notifications: Notification[], size = TRAY_SIZE): TraySelection {
  const pinned: Notification[] = [];
  const rest: Notification[] = [];

  for (const notification of notifications) {
    if (notification.kind === 'ask' && notification.answeredAt === null) pinned.push(notification);
    else rest.push(notification);
  }

  const latest = rest.slice(0, size);
  const hiddenRows = rest.slice(size);

  return {
    pinned,
    latest,
    hidden: hiddenRows.length,
    hiddenUnread: hiddenRows.reduce((n, row) => n + (row.readAt === null ? 1 : 0), 0),
  };
}

/**
 * The schedule that fires next, across every project.
 *
 * A past-due occurrence still counts. The runner ticks every 30 seconds, so
 * "due, not yet fired" is a real state, and dropping it would leave the tray
 * claiming nothing is coming while a reminder sits overdue. That is also why
 * `_nowMs` decides nothing here — it is taken so callers can pass the same
 * clock they format the answer with, not to filter by.
 *
 * A date that cannot be read is dropped rather than ordered as garbage: a
 * corrupt row must not become "next" and hide the schedule that really is.
 */
export function nextDueSchedule(schedules: Schedule[], _nowMs: number): Schedule | null {
  let best: Schedule | null = null;
  let bestAt = Number.POSITIVE_INFINITY;

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextDueAt === null) continue;
    const at = parseNotificationTimestamp(schedule.nextDueAt);
    if (at === null) continue;
    if (at.getTime() < bestAt) {
      best = schedule;
      bestAt = at.getTime();
    }
  }

  return best;
}
