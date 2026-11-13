import type { Schedule, ScheduleException } from '@/lib/tauri/schedules';
import { DAY } from './scheduleCalendar';
import { formatUtcStamp, parseUtcStamp } from '@/lib/time/utcStamp';
import { CRON_WEEKDAYS, readSimpleCron } from './scheduleFormat';

/**
 * Moving a run on the calendar or the timeline, as a change to the schedule.
 *
 * Two kinds, as in a calendar app: **one occurrence** becomes an exception on
 * the schedule (`originalAt` → `movedTo`), **the series** edits the rhythm so
 * every occurrence shifts. The series shift is only offered where the rhythm
 * can be rewritten without guessing — a plain interval, or a cron the editor
 * itself would write. Anything else returns `null` and the caller falls back
 * to the single occurrence.
 */

interface Civil {
  /** Days since 1970-01-01 of the local calendar date. */
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock `ms` shows in `timeZone`. */
function civilIn(ms: number, timeZone: string): Civil {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    day: Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY),
    hour: parts.hour,
    minute: parts.minute,
  };
}

/** The instant a wall clock reads in `timeZone` (the first one on a DST overlap is not special-cased). */
function instantOf(civil: Civil, timeZone: string): number {
  const naive = civil.day * DAY + (civil.hour * 60 + civil.minute) * 60_000;
  let guess = naive;
  // Two passes settle across a DST edge: the offset at the guess, then at the result.
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = civilIn(guess, timeZone);
    guess += naive - (seen.day * DAY + (seen.hour * 60 + seen.minute) * 60_000);
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function isMovedRun(schedule: Schedule, at: number): boolean {
  const stamp = formatUtcStamp(at);
  return (schedule.exceptions ?? []).some((exception) => exception.movedTo === stamp);
}

/** Only this occurrence: an exception, or an updated one when the run was moved before. */
export function moveOccurrence(schedule: Schedule, at: number, to: number): Schedule {
  const exceptions = schedule.exceptions ?? [];
  const stamp = formatUtcStamp(at);
  const originalAt = exceptions.find((e) => e.movedTo === stamp)?.originalAt ?? stamp;
  const others = exceptions.filter((e) => e.originalAt !== originalAt);
  const moved: ScheduleException = { originalAt, movedTo: formatUtcStamp(to) };
  // Dropped back on its own slot: the exception has nothing left to say.
  return {
    ...schedule,
    exceptions: moved.movedTo === originalAt ? others : [...others, moved],
  };
}

function shiftCron(schedule: Schedule, from: Civil, to: Civil): Schedule | null {
  const simple = readSimpleCron(schedule.cronExpr);
  if (simple === null) return null;

  const dayShift = to.day - from.day;
  const nextDow =
    simple.weekdays === null
      ? '*'
      : simple.weekdays
          .map(
            (name) =>
              (CRON_WEEKDAYS.indexOf(name as (typeof CRON_WEEKDAYS)[number]) + dayShift + 7 * 7) % 7
          )
          // Monday first, the order the editor writes them in.
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((index) => CRON_WEEKDAYS[index])
          .join(',');
  return {
    ...schedule,
    cronExpr: [simple.second, String(to.minute), String(to.hour), '*', '*', nextDow].join(' '),
  };
}

function shiftEvery(schedule: Schedule, at: number, to: number, from: Civil, dest: Civil) {
  if (schedule.anchorAt === null || schedule.anchorAt === undefined) return null;
  const anchor = parseUtcStamp(schedule.anchorAt);
  if (anchor === null) return null;
  if (schedule.everyUnit === 'hour') {
    return { ...schedule, anchorAt: formatUtcStamp(anchor + (to - at)) };
  }
  const local = civilIn(anchor, schedule.timezone);
  const moved = instantOf(
    { day: local.day + (dest.day - from.day), hour: dest.hour, minute: dest.minute },
    schedule.timezone
  );
  return {
    ...schedule,
    anchorAt: formatUtcStamp(moved),
    timeOfDay: `${pad(dest.hour)}:${pad(dest.minute)}`,
  };
}

/**
 * The whole series, shifted by what the run moved: its time of day, and its
 * weekday where the rhythm names weekdays. `null` when the rhythm cannot be
 * rewritten without guessing (monthly, ranges, steps, several hours).
 */
export function shiftSeries(schedule: Schedule, at: number, to: number): Schedule | null {
  const from = civilIn(at, schedule.timezone);
  const dest = civilIn(to, schedule.timezone);
  return schedule.specKind === 'every'
    ? shiftEvery(schedule, at, to, from, dest)
    : shiftCron(schedule, from, dest);
}
