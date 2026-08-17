import { describe, expect, it } from 'vitest';
import type { Notification } from './types';
import type { Schedule } from '@/lib/tauri/schedules';
import { nextDueSchedule, selectTray, TRAY_SIZE } from './tray';

let rowId = 0;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  rowId += 1;
  return {
    id: rowId,
    uid: `u${rowId}`,
    createdAt: `2026-08-12 10:00:0${rowId}`,
    projectPath: null,
    projectName: null,
    source: 'ui',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: `n${rowId}`,
    body: null,
    actions: [],
    dedupeKey: null,
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security scan',
    enabled: true,
    projectPath: null,
    projectName: null,
    specKind: 'every',
    cronExpr: null,
    everyN: 1,
    everyUnit: 'day',
    anchorAt: null,
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

const NOW = Date.parse('2026-08-17T12:00:00Z');

describe('selectTray', () => {
  it('keeps the newest few and says how many it left out', () => {
    const rows = [
      makeNotification({ title: 'a' }),
      makeNotification({ title: 'b' }),
      makeNotification({ title: 'c' }),
      makeNotification({ title: 'd' }),
      makeNotification({ title: 'e' }),
    ];

    const tray = selectTray(rows);

    expect(tray.latest.map((n) => n.title)).toEqual(['a', 'b', 'c']);
    expect(tray.hidden).toBe(2);
  });

  it('holds the order it was given', () => {
    const rows = [makeNotification({ title: 'newest' }), makeNotification({ title: 'older' })];

    expect(selectTray(rows).latest.map((n) => n.title)).toEqual(['newest', 'older']);
  });

  // A question is a debt. Age does not settle it, so the tray never lets one
  // scroll away — that is the whole reason `pinned` exists as its own list.
  it('pins every unanswered question, however old', () => {
    const rows = [
      makeNotification({ title: 'i1' }),
      makeNotification({ title: 'i2' }),
      makeNotification({ title: 'i3' }),
      makeNotification({ title: 'i4' }),
      makeNotification({ title: 'q', kind: 'ask' }),
    ];

    const tray = selectTray(rows);

    expect(tray.pinned.map((n) => n.title)).toEqual(['q']);
    expect(tray.latest.map((n) => n.title)).toEqual(['i1', 'i2', 'i3']);
    expect(tray.hidden).toBe(1);
  });

  it('pins many questions without capping them', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeNotification({ title: `q${i}`, kind: 'ask' })
    );

    const tray = selectTray(rows);

    expect(tray.pinned).toHaveLength(5);
    expect(tray.latest).toHaveLength(0);
    expect(tray.hidden).toBe(0);
  });

  // Settled means it is history, and history rotates out like any other row.
  it('lets an answered question rotate out', () => {
    const rows = [
      makeNotification({ title: 'i1' }),
      makeNotification({ title: 'i2' }),
      makeNotification({ title: 'i3' }),
      makeNotification({ title: 'answered', kind: 'ask', answeredAt: '2026-08-12 09:00:00' }),
    ];

    const tray = selectTray(rows);

    expect(tray.pinned).toHaveLength(0);
    expect(tray.hidden).toBe(1);
  });

  it('counts the unread among what it hid', () => {
    const rows = [
      makeNotification({ readAt: '2026-08-12 11:00:00' }),
      makeNotification({ readAt: '2026-08-12 11:00:00' }),
      makeNotification({ readAt: '2026-08-12 11:00:00' }),
      makeNotification({ title: 'hidden unread' }),
      makeNotification({ title: 'hidden read', readAt: '2026-08-12 11:00:00' }),
    ];

    const tray = selectTray(rows);

    expect(tray.hidden).toBe(2);
    expect(tray.hiddenUnread).toBe(1);
  });

  it('hides nothing when everything fits', () => {
    const tray = selectTray([makeNotification(), makeNotification()]);

    expect(tray.hidden).toBe(0);
    expect(tray.hiddenUnread).toBe(0);
  });

  it('takes a size for callers with more room', () => {
    const rows = Array.from({ length: 6 }, () => makeNotification());

    expect(selectTray(rows, 5).latest).toHaveLength(5);
    expect(TRAY_SIZE).toBe(3);
  });

  it('survives an empty inbox', () => {
    expect(selectTray([])).toEqual({ pinned: [], latest: [], hidden: 0, hiddenUnread: 0 });
  });
});

describe('nextDueSchedule', () => {
  it('picks the earliest date', () => {
    const later = makeSchedule({ id: 'late', nextDueAt: '2026-08-17 18:00:00' });
    const sooner = makeSchedule({ id: 'soon', nextDueAt: '2026-08-17 13:00:00' });

    expect(nextDueSchedule([later, sooner], NOW)?.id).toBe('soon');
  });

  it('ignores a disabled schedule', () => {
    const off = makeSchedule({ id: 'off', enabled: false, nextDueAt: '2026-08-17 13:00:00' });
    const on = makeSchedule({ id: 'on', nextDueAt: '2026-08-17 18:00:00' });

    expect(nextDueSchedule([off, on], NOW)?.id).toBe('on');
  });

  it('ignores a schedule with no date', () => {
    const undated = makeSchedule({ id: 'undated', nextDueAt: null });
    const dated = makeSchedule({ id: 'dated', nextDueAt: '2026-08-17 18:00:00' });

    expect(nextDueSchedule([undated, dated], NOW)?.id).toBe('dated');
  });

  // The runner ticks every 30s, so "due but not yet fired" is a real state.
  // Dropping it would leave the tray claiming nothing is coming.
  it('keeps a past-due schedule as the next one', () => {
    const overdue = makeSchedule({ id: 'overdue', nextDueAt: '2026-08-17 07:00:00' });
    const future = makeSchedule({ id: 'future', nextDueAt: '2026-08-17 18:00:00' });

    expect(nextDueSchedule([future, overdue], NOW)?.id).toBe('overdue');
  });

  it('reads the stored date as UTC', () => {
    // Read as local time this would land before the earlier row in Berlin.
    const a = makeSchedule({ id: 'a', nextDueAt: '2026-08-17 13:00:00' });
    const b = makeSchedule({ id: 'b', nextDueAt: '2026-08-17T12:30:00Z' });

    expect(nextDueSchedule([a, b], NOW)?.id).toBe('b');
  });

  it('answers null when nothing is scheduled', () => {
    expect(nextDueSchedule([], NOW)).toBeNull();
    expect(nextDueSchedule([makeSchedule({ nextDueAt: null })], NOW)).toBeNull();
  });

  it('drops a date it cannot read rather than ordering by garbage', () => {
    const broken = makeSchedule({ id: 'broken', nextDueAt: 'not a date' });
    const fine = makeSchedule({ id: 'fine', nextDueAt: '2026-08-17 18:00:00' });

    expect(nextDueSchedule([broken, fine], NOW)?.id).toBe('fine');
  });
});
