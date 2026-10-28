import type { Notification } from './types';
import { scheduleOccurrenceMs } from '@/lib/conductor/scheduledRun';
import { parseNotificationTimestamp } from './format';
import { scheduleIdFromDedupeKey } from './scheduleLink';
import type { Schedule } from '@/lib/tauri/schedules';

/**
 * What the calendar and the timeline draw, and nothing about how they draw it.
 *
 * One run is `{ schedule, at, state }`. Future runs come from the backend's
 * occurrence walk (the runner's own engine); past runs come from the
 * notifications a schedule raised, read through the dedupe key. There is no
 * stored run history, so `failed` is deliberately narrow: the run's
 * notification carried severity `error`. Anything else that fired is `fired`.
 */

export type ScheduleView = 'list' | 'calendar' | 'timeline';
export type TimelineLanes = 'project' | 'schedule';
export type RunState = 'upcoming' | 'fired' | 'failed';

export const SCHEDULE_VIEWS: ScheduleView[] = ['list', 'calendar', 'timeline'];

export function parseScheduleView(raw: string | null): ScheduleView {
  return raw === 'calendar' || raw === 'timeline' ? raw : 'list';
}

export interface ScheduleRun {
  /** Unique per schedule and instant. */
  key: string;
  scheduleId: string;
  at: number;
  state: RunState;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** `YYYY-MM-DD HH:MM:SS` in UTC, the shape the backend takes and gives. */
export function formatUtcStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseUtcStamp(raw: string): number | null {
  return parseNotificationTimestamp(raw)?.getTime() ?? null;
}

/** Monday 00:00 (local time) of the week holding `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(ms);
  const sinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday).getTime();
}

/** Local midnight `days` calendar days after `ms`'s own day — DST-safe, unlike `+ DAY`. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/**
 * Past runs, from the notifications schedules raised.
 *
 * A schedule with no notification left in the inbox (cleared) still has its
 * `lastFiredAt`; that one stamp is used so a cleared inbox does not make a
 * schedule look like it never ran.
 */
export function firedRuns(notifications: Notification[], schedules: Schedule[]): ScheduleRun[] {
  const known = new Set(schedules.map((schedule) => schedule.id));
  const runs = new Map<string, ScheduleRun>();
  const covered = new Set<string>();

  for (const notification of notifications) {
    const scheduleId = scheduleIdFromDedupeKey(notification.dedupeKey);
    const at = scheduleOccurrenceMs(notification.dedupeKey);
    if (scheduleId === null || at === null || !known.has(scheduleId)) continue;
    covered.add(scheduleId);
    const key = `${scheduleId}@${at}`;
    const failed = notification.severity === 'error' || runs.get(key)?.state === 'failed';
    runs.set(key, { key, scheduleId, at, state: failed ? 'failed' : 'fired' });
  }

  for (const schedule of schedules) {
    if (covered.has(schedule.id) || schedule.lastFiredAt === null) continue;
    const at = parseUtcStamp(schedule.lastFiredAt);
    if (at === null) continue;
    const key = `${schedule.id}@${at}`;
    runs.set(key, { key, scheduleId: schedule.id, at, state: 'fired' });
  }

  return [...runs.values()];
}

export function upcomingRuns(
  occurrences: { scheduleId: string; at: string[] }[],
  nowMs: number
): ScheduleRun[] {
  const runs: ScheduleRun[] = [];
  for (const entry of occurrences) {
    for (const raw of entry.at) {
      const at = parseUtcStamp(raw);
      if (at === null || at <= nowMs) continue;
      runs.push({
        key: `${entry.scheduleId}@${at}`,
        scheduleId: entry.scheduleId,
        at,
        state: 'upcoming',
      });
    }
  }
  return runs;
}

/** Runs inside `[from, to)`, oldest first. */
export function runsInRange(runs: ScheduleRun[], from: number, to: number): ScheduleRun[] {
  return runs.filter((run) => run.at >= from && run.at < to).sort((a, b) => a.at - b.at);
}

/** A stable hue per project, so the same project keeps its colour across views. */
export function projectHue(path: string | null): number {
  const text = path ?? '';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function projectColor(path: string | null): string {
  return path === null ? 'hsl(0 0% 62%)' : `hsl(${projectHue(path)} 62% 62%)`;
}

export interface WeekCell {
  /** Day column, 0 = Monday. */
  day: number;
  /** Minutes since local midnight. */
  minute: number;
}

export function cellOf(at: number, weekStart: number): WeekCell {
  const d = new Date(at);
  const day = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - weekStart) / DAY
  );
  return { day, minute: d.getHours() * 60 + d.getMinutes() };
}

export interface TimelineLane {
  key: string;
  label: string;
  path: string | null;
  scheduleIds: string[];
}

/**
 * Lanes for the timeline: one per project (the default), or one per schedule.
 * A schedule with no project shares one "No project" lane.
 */
export function buildLanes(schedules: Schedule[], mode: TimelineLanes): TimelineLane[] {
  if (mode === 'schedule') {
    return [...schedules]
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
      .map((schedule) => ({
        key: schedule.id,
        label: schedule.name,
        path: schedule.projectPath,
        scheduleIds: [schedule.id],
      }));
  }

  const byProject = new Map<string, TimelineLane>();
  for (const schedule of schedules) {
    const key = schedule.projectPath ?? '';
    const lane = byProject.get(key) ?? {
      key,
      label:
        schedule.projectName ??
        schedule.projectPath?.split('/').filter(Boolean).pop() ??
        'No project',
      path: schedule.projectPath,
      scheduleIds: [],
    };
    lane.scheduleIds.push(schedule.id);
    byProject.set(key, lane);
  }
  return [...byProject.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })
  );
}

export interface RunCluster {
  /** Position along the axis, 0–1, of the first run in the cluster. */
  at: number;
  runs: ScheduleRun[];
  /** The state that should colour the dot: failed beats fired beats upcoming. */
  state: RunState;
}

const STATE_RANK: Record<RunState, number> = { upcoming: 0, fired: 1, failed: 2 };

/**
 * Merges runs that would land within `minGap` of each other on the axis.
 * An hourly schedule over 30 days is 720 dots; drawn as written it is a smear,
 * so a cluster says how many it holds instead.
 */
export function clusterRuns(
  runs: ScheduleRun[],
  from: number,
  to: number,
  minGap: number
): RunCluster[] {
  const span = to - from;
  const clusters: RunCluster[] = [];
  let last: RunCluster | null = null;
  for (const run of [...runs].sort((a, b) => a.at - b.at)) {
    const pos = (run.at - from) / span;
    if (last !== null && pos - last.at < minGap) {
      last.runs.push(run);
      if (STATE_RANK[run.state] > STATE_RANK[last.state]) last.state = run.state;
    } else {
      last = { at: pos, runs: [run], state: run.state };
      clusters.push(last);
    }
  }
  return clusters;
}
