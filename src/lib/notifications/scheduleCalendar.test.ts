import { describe, expect, it } from 'vitest';
import type { Notification } from './types';
import type { Schedule } from '@/lib/tauri/schedules';
import {
  addDays,
  buildLanes,
  cellOf,
  clusterRuns,
  firedRuns,
  formatUtcStamp,
  parseScheduleView,
  projectColor,
  runsInRange,
  startOfWeek,
  upcomingRuns,
  type ScheduleRun,
} from './scheduleCalendar';

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Deploy',
    enabled: true,
    projectPath: '/repo/alpha',
    projectName: 'alpha',
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
    createdAt: '2026-08-01 00:00:00',
    updatedAt: '2026-08-01 00:00:00',
    ...overrides,
  };
}

function note(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    uid: 'n',
    createdAt: '2026-08-12 09:00:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: 't',
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

describe('parseScheduleView', () => {
  it('falls back to the list for anything unknown', () => {
    expect(parseScheduleView(null)).toBe('list');
    expect(parseScheduleView('nonsense')).toBe('list');
    expect(parseScheduleView('calendar')).toBe('calendar');
    expect(parseScheduleView('timeline')).toBe('timeline');
  });
});

describe('firedRuns', () => {
  it('reads the occurrence out of the dedupe key', () => {
    const runs = firedRuns([note({ dedupeKey: 'schedule:s1:2026-08-12 07:00:00' })], [schedule()]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      scheduleId: 's1',
      at: Date.parse('2026-08-12T07:00:00Z'),
      state: 'fired',
    });
  });

  it('marks a run failed only when its notification has severity error', () => {
    const runs = firedRuns(
      [
        note({ dedupeKey: 'schedule:s1:2026-08-12 07:00:00', severity: 'warn' }),
        note({ dedupeKey: 'schedule:s1:2026-08-13 07:00:00', severity: 'error' }),
      ],
      [schedule()]
    );
    const states = Object.fromEntries(runs.map((run) => [formatUtcStamp(run.at), run.state]));
    expect(states).toEqual({
      '2026-08-12 07:00:00': 'fired',
      '2026-08-13 07:00:00': 'failed',
    });
  });

  it('keeps failed when a second notification for the same run is not an error', () => {
    const key = 'schedule:s1:2026-08-12 07:00:00';
    const runs = firedRuns(
      [note({ dedupeKey: key, severity: 'error' }), note({ dedupeKey: key, severity: 'info' })],
      [schedule()]
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe('failed');
  });

  it('ignores notifications of deleted schedules and of other origins', () => {
    const runs = firedRuns(
      [note({ dedupeKey: 'schedule:gone:2026-08-12 07:00:00' }), note({ dedupeKey: 'other:1' })],
      [schedule()]
    );
    expect(runs).toEqual([]);
  });

  it('falls back to lastFiredAt when the inbox no longer holds the run', () => {
    const runs = firedRuns([], [schedule({ lastFiredAt: '2026-08-11 07:00:00' })]);
    expect(runs).toHaveLength(1);
    expect(runs[0].at).toBe(Date.parse('2026-08-11T07:00:00Z'));
  });

  it('does not add lastFiredAt when a notification already covers the schedule', () => {
    const runs = firedRuns(
      [note({ dedupeKey: 'schedule:s1:2026-08-12 07:00:00' })],
      [schedule({ lastFiredAt: '2026-08-12 07:00:05' })]
    );
    expect(runs).toHaveLength(1);
  });
});

describe('upcomingRuns', () => {
  it('drops anything that is not in the future and unreadable stamps', () => {
    const now = Date.parse('2026-08-12T10:00:00Z');
    const runs = upcomingRuns(
      [{ scheduleId: 's1', at: ['2026-08-12 09:00:00', '2026-08-12 11:00:00', 'garbage'] }],
      now
    );
    expect(runs.map((run) => run.state)).toEqual(['upcoming']);
    expect(runs[0].at).toBe(Date.parse('2026-08-12T11:00:00Z'));
  });
});

describe('weeks', () => {
  it('starts on Monday, local time', () => {
    const wednesday = new Date(2026, 7, 12, 15, 30).getTime();
    const monday = new Date(startOfWeek(wednesday));
    expect([monday.getDay(), monday.getHours(), monday.getDate()]).toEqual([1, 0, 10]);
  });

  it('treats Sunday as the last day of the week, not the first', () => {
    const sunday = new Date(2026, 7, 16, 12).getTime();
    expect(new Date(startOfWeek(sunday)).getDate()).toBe(10);
  });

  it('steps whole calendar days across a DST change', () => {
    const before = new Date(2026, 9, 24, 12).getTime();
    const after = new Date(addDays(before, 2));
    expect([after.getDate(), after.getHours()]).toEqual([26, 0]);
  });

  it('places a run in its day column and minute', () => {
    const week = startOfWeek(new Date(2026, 7, 12).getTime());
    const cell = cellOf(new Date(2026, 7, 14, 17, 45).getTime(), week);
    expect(cell).toEqual({ day: 4, minute: 17 * 60 + 45 });
  });

  it('selects runs in a half-open range', () => {
    const run = (at: number): ScheduleRun => ({
      key: String(at),
      scheduleId: 's',
      at,
      state: 'fired',
    });
    expect(runsInRange([run(3), run(1), run(5), run(2)], 2, 5).map((r) => r.at)).toEqual([2, 3]);
  });
});

describe('buildLanes', () => {
  const schedules = [
    schedule({ id: 'a', name: 'B job', projectPath: '/p/zeta', projectName: 'zeta' }),
    schedule({ id: 'b', name: 'A job', projectPath: '/p/alpha', projectName: 'alpha' }),
    schedule({ id: 'c', name: 'C job', projectPath: '/p/alpha', projectName: 'alpha' }),
    schedule({ id: 'd', name: 'D job', projectPath: null, projectName: null }),
  ];

  it('makes one lane per project, sorted by name, with an extra lane for no project', () => {
    const lanes = buildLanes(schedules, 'project');
    expect(lanes.map((lane) => lane.label)).toEqual(['alpha', 'No project', 'zeta']);
    expect(lanes[0].scheduleIds).toEqual(['b', 'c']);
  });

  it('makes one lane per schedule on request', () => {
    const lanes = buildLanes(schedules, 'schedule');
    expect(lanes.map((lane) => lane.label)).toEqual(['A job', 'B job', 'C job', 'D job']);
  });
});

describe('clusterRuns', () => {
  const run = (at: number, state: ScheduleRun['state'] = 'fired'): ScheduleRun => ({
    key: `s@${at}`,
    scheduleId: 's',
    at,
    state,
  });

  it('keeps well-separated runs apart and merges close ones', () => {
    const clusters = clusterRuns([run(0), run(1), run(500), run(1000)], 0, 1000, 0.01);
    expect(clusters.map((c) => c.runs.length)).toEqual([2, 1, 1]);
  });

  it('lets the worst state colour a cluster', () => {
    const clusters = clusterRuns(
      [run(0, 'upcoming'), run(1, 'failed'), run(2, 'fired')],
      0,
      1000,
      0.01
    );
    expect(clusters[0].state).toBe('failed');
  });
});

describe('projectColor', () => {
  it('is stable per project and neutral without one', () => {
    expect(projectColor('/p/a')).toBe(projectColor('/p/a'));
    expect(projectColor(null)).toBe('hsl(0 0% 62%)');
  });
});
