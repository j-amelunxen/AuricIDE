import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/lib/tauri/schedules';
import { dailyCron, formatNextDue, formatScheduleRhythm, weeklyCron } from './scheduleFormat';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security-Scan',
    enabled: true,
    projectPath: null,
    projectName: null,
    specKind: 'every',
    cronExpr: null,
    everyN: 21,
    everyUnit: 'day',
    anchorAt: '2026-08-12 07:00:00',
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: null,
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

describe('formatScheduleRhythm', () => {
  describe('interval schedules', () => {
    it('names a multi-day interval with its time', () => {
      expect(formatScheduleRhythm(makeSchedule())).toBe('alle 21 Tage · 09:00');
    });

    it('uses the singular for an interval of one', () => {
      expect(formatScheduleRhythm(makeSchedule({ everyN: 1 }))).toBe('jeden Tag · 09:00');
    });

    it('names a weekly interval', () => {
      expect(formatScheduleRhythm(makeSchedule({ everyN: 2, everyUnit: 'week' }))).toBe(
        'alle 2 Wochen · 09:00'
      );
    });

    // An hourly rhythm has no meaningful time of day.
    it('leaves the time off an hourly interval', () => {
      expect(formatScheduleRhythm(makeSchedule({ everyN: 6, everyUnit: 'hour' }))).toBe(
        'alle 6 Stunden'
      );
    });
  });

  describe('cron schedules', () => {
    it('spells out a weekday expression', () => {
      const schedule = makeSchedule({ specKind: 'cron', cronExpr: '0 0 17 * * WED' });
      expect(formatScheduleRhythm(schedule)).toBe('Mittwoch · 17:00');
    });

    it('lists several weekdays', () => {
      const schedule = makeSchedule({ specKind: 'cron', cronExpr: '0 30 8 * * MON,FRI' });
      expect(formatScheduleRhythm(schedule)).toBe('Montag, Freitag · 08:30');
    });

    it('names a daily expression', () => {
      const schedule = makeSchedule({ specKind: 'cron', cronExpr: '0 0 9 * * *' });
      expect(formatScheduleRhythm(schedule)).toBe('täglich · 09:00');
    });

    // Better an honest raw expression than a confident wrong translation.
    it('shows a hand-written expression verbatim', () => {
      const schedule = makeSchedule({ specKind: 'cron', cronExpr: '0 0 3 1,15 * *' });
      expect(formatScheduleRhythm(schedule)).toBe('0 0 3 1,15 * *');
    });

    it('says so when there is no expression at all', () => {
      const schedule = makeSchedule({ specKind: 'cron', cronExpr: null });
      expect(formatScheduleRhythm(schedule)).toBe('kein Rhythmus');
    });
  });
});

describe('formatNextDue', () => {
  const now = Date.parse('2026-08-12T10:00:00.000Z');

  it('says a disabled schedule is off', () => {
    expect(
      formatNextDue(makeSchedule({ enabled: false, nextDueAt: '2026-08-13 09:00:00' }), now)
    ).toBe('aus');
  });

  it.each([
    ['in 30 min', '2026-08-12 10:30:00'],
    ['in 3 h', '2026-08-12 13:00:00'],
    ['in 2 d', '2026-08-14 10:00:00'],
  ])('renders %s', (expected, nextDueAt) => {
    expect(formatNextDue(makeSchedule({ nextDueAt }), now)).toBe(expected);
  });

  // The runner ticks every 30s, so a due-but-not-yet-run schedule really exists
  // for a moment — it must read as overdue, not as a stale future date.
  it('calls a past due time overdue', () => {
    expect(formatNextDue(makeSchedule({ nextDueAt: '2026-08-12 09:00:00' }), now)).toBe(
      'jetzt fällig'
    );
  });

  it.each([
    ['no stored time', null],
    ['an unparseable time', 'garbage'],
  ])('says there is no date for %s', (_label, nextDueAt) => {
    expect(formatNextDue(makeSchedule({ nextDueAt }), now)).toBe('kein Termin');
  });
});

describe('cron builders', () => {
  // The trap this avoids: the `cron` crate counts Sunday as 1 while ordinary
  // cron counts it as 0. Names cannot be misread.
  it('writes weekdays as names, never numbers', () => {
    expect(weeklyCron(['WED'], '17:00')).toBe('0 0 17 * * WED');
  });

  it('joins several weekdays', () => {
    expect(weeklyCron(['MON', 'FRI'], '08:30')).toBe('0 30 8 * * MON,FRI');
  });

  it('falls back to Monday rather than producing an empty day field', () => {
    expect(weeklyCron([], '09:00')).toBe('0 0 9 * * MON');
  });

  it('builds a daily expression', () => {
    expect(dailyCron('06:05')).toBe('0 5 6 * * *');
  });

  // Six fields, because the crate's first field is seconds.
  it.each([
    ['weekly', weeklyCron(['WED'], '17:00')],
    ['daily', dailyCron('09:00')],
  ])('emits six fields for %s', (_label, expr) => {
    expect(expr.split(/\s+/)).toHaveLength(6);
  });

  it('round-trips through the formatter', () => {
    const schedule = makeSchedule({ specKind: 'cron', cronExpr: weeklyCron(['WED'], '17:00') });
    expect(formatScheduleRhythm(schedule)).toBe('Mittwoch · 17:00');
  });
});
