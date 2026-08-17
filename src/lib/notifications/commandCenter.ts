import type { Schedule } from '@/lib/tauri/schedules';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { formatNotificationProject, parseNotificationTimestamp } from './format';
import { scheduleIdFromDedupeKey } from './scheduleLink';
import type { Notification, NotificationAction } from './types';

/**
 * The Command Center is a projection, not a place where state lives.
 *
 * Everything it shows is derived here, from the two lists the store already
 * holds plus the starred projects — no new notification or schedule state
 * exists for it. That is what keeps the center and the tray from being able to
 * disagree about how many rows are unread or which schedule fires next.
 */

/** The key for rows and schedules that belong to the app rather than a project. */
export const APP_WIDE_KEY = '__app__';

export interface ProjectGroup {
  /** Stable identity for selection: the project path, or {@link APP_WIDE_KEY}. */
  key: string;
  path: string | null;
  label: string;
  /** In the order the inbox gave them — newest first. */
  notifications: Notification[];
  unread: number;
  openQuestions: number;
  /** Every schedule of this project, disabled ones included. */
  schedules: Schedule[];
  /** Earliest date an *enabled* schedule is due, as stored. */
  nextDueAt: string | null;
}

interface GroupDraft {
  key: string;
  path: string | null;
  /** The best name seen so far; the path is only fallen back on at the end. */
  name: string | null;
  notifications: Notification[];
  schedules: Schedule[];
}

function draftFor(drafts: Map<string, GroupDraft>, path: string | null): GroupDraft {
  const key = path ?? APP_WIDE_KEY;
  const existing = drafts.get(key);
  if (existing !== undefined) return existing;

  const draft: GroupDraft = { key, path, name: null, notifications: [], schedules: [] };
  drafts.set(key, draft);
  return draft;
}

/** First non-empty name wins — a later row leaving it blank must not unname the group. */
function nameFrom(draft: GroupDraft, candidate: string | null): void {
  if (draft.name === null && candidate !== null && candidate !== '') draft.name = candidate;
}

function dueMs(nextDueAt: string | null): number {
  if (nextDueAt === null) return Number.POSITIVE_INFINITY;
  const at = parseNotificationTimestamp(nextDueAt);
  return at === null ? Number.POSITIVE_INFINITY : at.getTime();
}

/** The soonest an enabled schedule in this set is due, or null. */
function earliestDue(schedules: Schedule[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextDueAt === null) continue;
    const ms = dueMs(schedule.nextDueAt);
    if (ms < earliestMs) {
      earliest = schedule.nextDueAt;
      earliestMs = ms;
    }
  }

  return earliest;
}

/**
 * One row per place, for the rail.
 *
 * Starred projects join even when they hold nothing: the rail is also how you
 * reach "+ New schedule" for a project, and a project you have to visit first
 * to give a reminder to is one click too many. The app-wide group is the
 * exception — it has no "+ New schedule" story of its own, so it appears only
 * once something actually lives there rather than sitting empty at the top.
 *
 * The order answers "where should I look first": open questions, then unread,
 * then what is due soonest, then the name so the rail stops moving once those
 * are equal.
 */
export function groupByProject(
  notifications: Notification[],
  schedules: Schedule[],
  starred: StarredProject[]
): ProjectGroup[] {
  const drafts = new Map<string, GroupDraft>();

  for (const notification of notifications) {
    const draft = draftFor(drafts, notification.projectPath);
    nameFrom(draft, notification.projectName);
    draft.notifications.push(notification);
  }

  for (const schedule of schedules) {
    const draft = draftFor(drafts, schedule.projectPath);
    nameFrom(draft, schedule.projectName);
    draft.schedules.push(schedule);
  }

  for (const project of starred) {
    const draft = draftFor(drafts, project.path);
    nameFrom(draft, project.name);
  }

  const groups: ProjectGroup[] = [];
  for (const draft of drafts.values()) {
    const isEmpty = draft.notifications.length === 0 && draft.schedules.length === 0;
    if (draft.path === null && isEmpty) continue;

    groups.push({
      key: draft.key,
      path: draft.path,
      label: formatNotificationProject(draft.name, draft.path),
      notifications: draft.notifications,
      unread: draft.notifications.reduce((n, row) => n + (row.readAt === null ? 1 : 0), 0),
      openQuestions: draft.notifications.reduce(
        (n, row) => n + (row.kind === 'ask' && row.answeredAt === null ? 1 : 0),
        0
      ),
      schedules: draft.schedules,
      nextDueAt: earliestDue(draft.schedules),
    });
  }

  return groups.sort(
    (a, b) =>
      b.openQuestions - a.openQuestions ||
      b.unread - a.unread ||
      dueMs(a.nextDueAt) - dueMs(b.nextDueAt) ||
      a.label.localeCompare(b.label)
  );
}

/**
 * What fires next across every project, soonest first.
 *
 * Past-due entries stay in — same reason as `nextDueSchedule`: overdue is
 * exactly the state the strip exists to make visible. `_nowMs` is taken so the
 * caller's tick is the clock the strip is formatted against. Unbounded by
 * default: the strip scrolls, and a cut-off list that does not say it is cut
 * off would make nine reminders look like six.
 */
export function upcomingSchedules(
  schedules: Schedule[],
  _nowMs: number,
  limit = Number.POSITIVE_INFINITY
): Schedule[] {
  return schedules
    .filter(
      (schedule) =>
        // A date that cannot be read sorts as infinity, which would park it at
        // the head of the strip once a limit cuts the list — same reason
        // `nextDueSchedule` drops it rather than ordering it.
        schedule.enabled &&
        schedule.nextDueAt !== null &&
        Number.isFinite(dueMs(schedule.nextDueAt))
    )
    .sort((a, b) => dueMs(a.nextDueAt) - dueMs(b.nextDueAt))
    .slice(0, limit);
}

/**
 * The newest notification each schedule raised, keyed by schedule id.
 *
 * Lets a schedule row show what it last produced, not just when it last ran.
 * The link is the dedupe key alone — see `scheduleLink.ts` for why the origin
 * label is not allowed to stand in for it.
 */
export function lastRaisedBySchedule(notifications: Notification[]): Map<string, Notification> {
  const newest = new Map<string, Notification>();

  for (const notification of notifications) {
    const scheduleId = scheduleIdFromDedupeKey(notification.dedupeKey);
    if (scheduleId === null) continue;

    const held = newest.get(scheduleId);
    // Not assuming the input order: whichever row is actually newer wins.
    if (held === undefined || notification.createdAt.localeCompare(held.createdAt) > 0) {
      newest.set(scheduleId, notification);
    }
  }

  return newest;
}

export interface CenterSummary {
  unread: number;
  openQuestions: number;
  schedules: number;
}

/**
 * The header's numbers, over the whole inbox — never the selected group, and
 * never the filtered view. A summary that shrinks when you click a project in
 * the rail would be answering a different question than the one it asks.
 */
export function centerSummary(notifications: Notification[], schedules: Schedule[]): CenterSummary {
  let unread = 0;
  let openQuestions = 0;

  for (const notification of notifications) {
    if (notification.readAt === null) unread += 1;
    if (notification.kind === 'ask' && notification.answeredAt === null) openQuestions += 1;
  }

  return { unread, openQuestions, schedules: schedules.length };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The summary as one line.
 *
 * Zero parts are dropped so the sentence stays about what there is — except
 * "0 unread", which is the all-clear and the one thing worth saying explicitly.
 *
 * No project count: the rail right below is the list of projects, and it also
 * carries the idle starred ones, so a number here would read as a miscount of
 * something the reader can see.
 */
export function formatCenterSummary(s: CenterSummary): string {
  // Open questions are deliberately absent: the header shows them as their own
  // amber badge, and one number said twice in a row reads as two numbers.
  const parts = [count(s.unread, 'unread', 'unread')];
  if (s.schedules > 0) parts.push(count(s.schedules, 'schedule', 'schedules'));
  return parts.join(' · ');
}

/**
 * Whether running this action should shut the Command Center behind it.
 *
 * Every kind but one lands somewhere the overlay is covering — a file, a
 * ticket, a goal, the terminal of the agent it just started — so leaving the
 * center up would hide the thing the click asked for. Answering a question is
 * the exception: the result is the row itself, and closing would take away the
 * rest of the inbox the user was working through.
 */
export function closesCommandCenter(action: NotificationAction): boolean {
  return action.kind !== 'answer';
}
