import type { Schedule } from '@/lib/tauri/schedules';
import type { ScheduleCatchUp, ScheduleEveryUnit } from '@/lib/notifications/scheduleVocabulary';
import { parseUtcDate } from '@/lib/time/utcStamp';

/**
 * Turning a schedule back into words.
 *
 * A stored rhythm is `{ specKind: 'every', everyN: 21, everyUnit: 'day',
 * timeOfDay: '09:00' }`. Nobody reads that off a list, so the panel shows
 * "every 21 days · 09:00" — and the cron form, which nobody should have to
 * decode either, gets named where it is nameable.
 */

const UNIT_SINGULAR: Record<ScheduleEveryUnit, string> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
};

const UNIT_PLURAL: Record<ScheduleEveryUnit, string> = {
  hour: 'hours',
  day: 'days',
  week: 'weeks',
};

/** English weekday names, indexed the way cron day-of-week names abbreviate. */
const WEEKDAY_NAMES: Record<string, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

export const CATCH_UP_LABELS: Record<ScheduleCatchUp, string> = {
  coalesce: 'Catch up once',
  skip: 'Skip missed',
  all: 'Every missed one',
};

export const CATCH_UP_HINTS: Record<ScheduleCatchUp, string> = {
  coalesce: 'One notification that says how overdue it is.',
  skip: 'Missed dates are done; it continues with the next one.',
  all: 'Each missed date separately, capped at 10.',
};

/**
 * Names the rhythm.
 *
 * A cron expression the editor generated (`0 0 17 * * WED`) is recognised and
 * spelled out. Anything hand-written falls back to showing the expression —
 * better an honest raw string than a confident wrong translation.
 */
export function formatScheduleRhythm(schedule: Schedule): string {
  if (schedule.specKind === 'every') {
    const n = schedule.everyN ?? 1;
    const unit = schedule.everyUnit ?? 'day';
    const noun = n === 1 ? UNIT_SINGULAR[unit] : UNIT_PLURAL[unit];
    const every = n === 1 ? `every ${noun}` : `every ${n} ${noun}`;
    return unit === 'hour' || schedule.timeOfDay === null
      ? every
      : `${every} · ${schedule.timeOfDay}`;
  }

  const expr = schedule.cronExpr?.trim() ?? '';
  const simple = readSimpleCron(expr);
  if (simple) {
    const time = `${String(simple.hour).padStart(2, '0')}:${String(simple.minute).padStart(2, '0')}`;
    if (simple.weekdays === null) return `daily · ${time}`;
    return `${simple.weekdays.map((day) => WEEKDAY_NAMES[day]).join(', ')} · ${time}`;
  }

  return expr === '' ? 'no rhythm' : expr;
}

/** The next occurrence in words, or a note that there is none. */
export function formatNextDue(schedule: Schedule, now: number): string {
  if (!schedule.enabled) return 'off';
  if (schedule.nextDueAt === null) return 'no date';

  const at = parseUtcDate(schedule.nextDueAt);
  if (at === null) return 'no date';

  const minutes = Math.round((at.getTime() - now) / 60_000);
  // A due-but-not-yet-run schedule reads as overdue rather than as a stale
  // future date — the runner ticks every 30s, so this window is brief but real.
  if (minutes <= 0) return 'due now';
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;

  return `in ${Math.round(hours / 24)} d`;
}

/** Weekday names the cron crate reads, Sunday first (the crate counts Sunday as 1). */
export const CRON_WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * The daily or weekly rhythm a cron expression holds in the shape
 * `dailyCron`/`weeklyCron` write: a fixed minute and hour on every day of every
 * month, on all weekdays (`weekdays: null`) or on named ones. Five fields read
 * as second 0. Anything else is a hand-written expression: null.
 */
export function readSimpleCron(
  expr: string | null | undefined
): { second: string; minute: number; hour: number; weekdays: string[] | null } | null {
  const fields = expr?.trim().split(/\s+/) ?? [];
  if (fields.length === 5) fields.unshift('0');
  if (fields.length !== 6) return null;
  const [second, minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || dayOfMonth !== '*' || month !== '*') {
    return null;
  }
  if (dayOfWeek === '*')
    return { second, minute: Number(minute), hour: Number(hour), weekdays: null };
  const weekdays = dayOfWeek.toUpperCase().split(',');
  if (!weekdays.every((day) => (CRON_WEEKDAYS as readonly string[]).includes(day))) return null;
  return { second, minute: Number(minute), hour: Number(hour), weekdays };
}

/**
 * Builds the six-field cron expression for a weekly rhythm.
 *
 * Weekdays go in as **names**, not numbers: the `cron` crate counts Sunday as 1
 * while ordinary cron counts it as 0, and a silent off-by-one would move a
 * reminder to the wrong day. Names cannot be misread.
 */
export function weeklyCron(weekdays: string[], time: string): string {
  const [hour = '0', minute = '0'] = time.split(':');
  const days = weekdays.length > 0 ? weekdays.join(',') : 'MON';
  return `0 ${Number(minute)} ${Number(hour)} * * ${days}`;
}

/** The six-field expression for a daily rhythm. */
export function dailyCron(time: string): string {
  const [hour = '0', minute = '0'] = time.split(':');
  return `0 ${Number(minute)} ${Number(hour)} * * *`;
}

export const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: 'MON', label: 'Mon' },
  { value: 'TUE', label: 'Tue' },
  { value: 'WED', label: 'Wed' },
  { value: 'THU', label: 'Thu' },
  { value: 'FRI', label: 'Fri' },
  { value: 'SAT', label: 'Sat' },
  { value: 'SUN', label: 'Sun' },
];
