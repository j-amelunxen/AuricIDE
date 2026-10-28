import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/lib/tauri/schedules';
import { isMovedRun, moveOccurrence, shiftSeries } from './scheduleMove';

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Deploy',
    enabled: true,
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    specKind: 'cron',
    cronExpr: '0 0 9 * * WED',
    everyN: null,
    everyUnit: null,
    anchorAt: null,
    timeOfDay: null,
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: null,
    createdAt: '2026-08-01 00:00:00',
    updatedAt: '2026-08-01 00:00:00',
    ...overrides,
  };
}

// Wed 2026-10-28 09:00 Berlin (CET, UTC+1) = 08:00 UTC.
const WED_0900 = Date.UTC(2026, 9, 28, 8, 0);

describe('moveOccurrence', () => {
  it('records the move as an exception and leaves the rhythm alone', () => {
    const next = moveOccurrence(schedule(), WED_0900, Date.UTC(2026, 9, 29, 13, 15));
    expect(next.exceptions).toEqual([
      { originalAt: '2026-10-28 08:00:00', movedTo: '2026-10-29 13:15:00' },
    ]);
    expect(next.cronExpr).toBe('0 0 9 * * WED');
  });

  it('keeps pointing at the original when a moved run is moved again', () => {
    const once = moveOccurrence(schedule(), WED_0900, Date.UTC(2026, 9, 29, 13, 15));
    const twice = moveOccurrence(once, Date.UTC(2026, 9, 29, 13, 15), Date.UTC(2026, 9, 30, 7, 0));
    expect(twice.exceptions).toEqual([
      { originalAt: '2026-10-28 08:00:00', movedTo: '2026-10-30 07:00:00' },
    ]);
    expect(isMovedRun(twice, Date.UTC(2026, 9, 30, 7, 0))).toBe(true);
    expect(isMovedRun(twice, WED_0900)).toBe(false);
  });

  it('drops the exception when the run goes back to its own slot', () => {
    const once = moveOccurrence(schedule(), WED_0900, Date.UTC(2026, 9, 29, 13, 15));
    const back = moveOccurrence(once, Date.UTC(2026, 9, 29, 13, 15), WED_0900);
    expect(back.exceptions).toEqual([]);
  });
});

describe('shiftSeries', () => {
  it('moves the weekday and the time of a weekly cron', () => {
    // Thursday 14:30 Berlin.
    const next = shiftSeries(schedule(), WED_0900, Date.UTC(2026, 9, 29, 13, 30));
    expect(next?.cronExpr).toBe('0 30 14 * * THU');
  });

  it('shifts every named weekday by the same distance, wrapping the week', () => {
    const next = shiftSeries(
      schedule({ cronExpr: '0 0 9 * * MON,SAT' }),
      Date.UTC(2026, 9, 31, 8, 0),
      Date.UTC(2026, 10, 2, 8, 0)
    );
    expect(next?.cronExpr).toBe('0 0 9 * * MON,WED');
  });

  it('changes only the time of a daily cron', () => {
    const next = shiftSeries(
      schedule({ cronExpr: '0 0 9 * * *' }),
      WED_0900,
      Date.UTC(2026, 9, 30, 6, 0)
    );
    expect(next?.cronExpr).toBe('0 0 7 * * *');
  });

  it('refuses a cron it cannot rewrite without guessing', () => {
    const to = Date.UTC(2026, 9, 29, 13, 30);
    for (const cronExpr of ['0 0 9 1 * *', '0 0 9,17 * * *', '0 */5 * * * *', '0 0 9 * * 1-5']) {
      expect(shiftSeries(schedule({ cronExpr }), WED_0900, to)).toBeNull();
    }
  });

  it('moves the anchor and the time of day of a daily interval', () => {
    const interval = schedule({
      specKind: 'every',
      cronExpr: null,
      everyN: 3,
      everyUnit: 'day',
      anchorAt: '2026-10-26 08:00:00',
      timeOfDay: '09:00',
    });
    const next = shiftSeries(interval, WED_0900, Date.UTC(2026, 9, 29, 13, 30));
    expect(next?.timeOfDay).toBe('14:30');
    expect(next?.anchorAt).toBe('2026-10-27 13:30:00');
  });

  it('moves an hourly interval by the distance dragged', () => {
    const hourly = schedule({
      specKind: 'every',
      cronExpr: null,
      everyN: 2,
      everyUnit: 'hour',
      anchorAt: '2026-10-28 08:00:00',
    });
    const next = shiftSeries(hourly, WED_0900, WED_0900 + 45 * 60_000);
    expect(next?.anchorAt).toBe('2026-10-28 08:45:00');
  });

  it('reads the day in the schedule zone, not the viewer zone', () => {
    // 23:30 UTC on Oct 28 is already Thursday 00:30 in Berlin; dragging it to
    // Friday 00:30 Berlin is one day, whatever zone the viewer sits in.
    const next = shiftSeries(
      schedule({ cronExpr: '0 30 0 * * THU' }),
      Date.UTC(2026, 9, 28, 23, 30),
      Date.UTC(2026, 9, 29, 23, 30)
    );
    expect(next?.cronExpr).toBe('0 30 0 * * FRI');
  });
});
