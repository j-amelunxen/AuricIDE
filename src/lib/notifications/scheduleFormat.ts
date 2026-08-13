import type { Schedule, ScheduleCatchUp, ScheduleEveryUnit } from '@/lib/tauri/schedules';
import { parseNotificationTimestamp } from './format';

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
  const fields = expr.split(/\s+/);
  // Six fields, seconds first — what the editor writes and what the `cron`
  // crate expects.
  if (fields.length === 6) {
    const [, minute, hour, dayOfMonth, month, dayOfWeek] = fields;
    const time =
      /^\d+$/.test(hour) && /^\d+$/.test(minute)
        ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
        : null;

    if (dayOfMonth === '*' && month === '*' && time !== null) {
      if (dayOfWeek === '*') return `daily · ${time}`;
      const days = dayOfWeek
        .split(',')
        .map((day) => WEEKDAY_NAMES[day.toUpperCase()])
        .filter((day): day is string => day !== undefined);
      if (days.length > 0) return `${days.join(', ')} · ${time}`;
    }
  }

  return expr === '' ? 'no rhythm' : expr;
}

/** The next occurrence in words, or a note that there is none. */
export function formatNextDue(schedule: Schedule, now: number): string {
  if (!schedule.enabled) return 'off';
  if (schedule.nextDueAt === null) return 'no date';

  const at = parseNotificationTimestamp(schedule.nextDueAt);
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
