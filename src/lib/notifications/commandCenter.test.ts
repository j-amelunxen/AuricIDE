import { describe, expect, it } from 'vitest';
import type { Notification, NotificationAction } from './types';
import type { Schedule } from '@/lib/tauri/schedules';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import {
  APP_WIDE_KEY,
  centerSummary,
  closesCommandCenter,
  formatCenterSummary,
  groupByProject,
  lastRaisedBySchedule,
  upcomingSchedules,
} from './commandCenter';

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

function makeStarred(path: string, name: string): StarredProject {
  return { path, name, starredAt: 1 };
}

const NOW = Date.parse('2026-08-17T12:00:00Z');

describe('groupByProject', () => {
  it('puts a project’s rows and schedules in one group', () => {
    const groups = groupByProject(
      [makeNotification({ projectPath: '/repos/alpha', projectName: 'Alpha' })],
      [makeSchedule({ projectPath: '/repos/alpha', projectName: 'Alpha' })],
      []
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '/repos/alpha', path: '/repos/alpha', label: 'Alpha' });
    expect(groups[0].notifications).toHaveLength(1);
    expect(groups[0].schedules).toHaveLength(1);
  });

  it('names a project from its path when no row carries a name', () => {
    const groups = groupByProject([makeNotification({ projectPath: '/repos/beta' })], [], []);

    expect(groups[0].label).toBe('beta');
  });

  it('collects rows that belong to no project under one app-wide key', () => {
    const groups = groupByProject([makeNotification({ projectPath: null })], [], []);

    expect(groups[0].key).toBe(APP_WIDE_KEY);
    expect(groups[0].path).toBeNull();
    expect(groups[0].label).toBe('App');
  });

  // A rail full of empty scaffolding is noise; the app-wide entry earns its
  // place only once something actually lives there.
  it('leaves out the app-wide group when nothing belongs to it', () => {
    const groups = groupByProject(
      [makeNotification({ projectPath: '/repos/alpha' })],
      [makeSchedule({ projectPath: '/repos/alpha' })],
      []
    );

    expect(groups.map((g) => g.key)).toEqual(['/repos/alpha']);
  });

  // The rail is also how you reach "+ New schedule" for a project that has
  // nothing yet — so a starred project is listed before it has any history.
  it('lists a starred project that has nothing', () => {
    const groups = groupByProject([], [], [makeStarred('/repos/gamma', 'Gamma')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: '/repos/gamma',
      label: 'Gamma',
      unread: 0,
      openQuestions: 0,
      nextDueAt: null,
    });
  });

  it('does not duplicate a starred project that already has rows', () => {
    const groups = groupByProject(
      [makeNotification({ projectPath: '/repos/alpha', projectName: 'Alpha' })],
      [],
      [makeStarred('/repos/alpha', 'Alpha')]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].notifications).toHaveLength(1);
  });

  it('counts unread and open questions per group', () => {
    const groups = groupByProject(
      [
        makeNotification({ projectPath: '/repos/alpha' }),
        makeNotification({ projectPath: '/repos/alpha', readAt: '2026-08-12 11:00:00' }),
        makeNotification({ projectPath: '/repos/alpha', kind: 'ask' }),
        makeNotification({
          projectPath: '/repos/alpha',
          kind: 'ask',
          answeredAt: '2026-08-12 11:00:00',
          readAt: '2026-08-12 11:00:00',
        }),
      ],
      [],
      []
    );

    expect(groups[0].unread).toBe(2);
    expect(groups[0].openQuestions).toBe(1);
  });

  it('takes the earliest date its schedules are due', () => {
    const groups = groupByProject(
      [],
      [
        makeSchedule({ id: 'a', projectPath: '/repos/alpha', nextDueAt: '2026-08-17 18:00:00' }),
        makeSchedule({ id: 'b', projectPath: '/repos/alpha', nextDueAt: '2026-08-17 13:00:00' }),
      ],
      []
    );

    expect(groups[0].nextDueAt).toBe('2026-08-17 13:00:00');
  });

  it('ignores a disabled schedule when dating the group', () => {
    const groups = groupByProject(
      [],
      [
        makeSchedule({
          id: 'off',
          projectPath: '/repos/alpha',
          enabled: false,
          nextDueAt: '2026-08-17 13:00:00',
        }),
        makeSchedule({ id: 'on', projectPath: '/repos/alpha', nextDueAt: '2026-08-17 18:00:00' }),
      ],
      []
    );

    // The row still belongs to the project — it is only not what dates it.
    expect(groups[0].schedules).toHaveLength(2);
    expect(groups[0].nextDueAt).toBe('2026-08-17 18:00:00');
  });

  it('keeps the newest-first order the inbox handed it', () => {
    const groups = groupByProject(
      [
        makeNotification({ projectPath: '/repos/alpha', title: 'newest' }),
        makeNotification({ projectPath: '/repos/alpha', title: 'older' }),
      ],
      [],
      []
    );

    expect(groups[0].notifications.map((n) => n.title)).toEqual(['newest', 'older']);
  });

  describe('order', () => {
    it('puts open questions first', () => {
      const groups = groupByProject(
        [
          makeNotification({ projectPath: '/repos/alpha' }),
          makeNotification({ projectPath: '/repos/alpha' }),
          makeNotification({ projectPath: '/repos/beta', kind: 'ask' }),
        ],
        [],
        []
      );

      expect(groups.map((g) => g.key)).toEqual(['/repos/beta', '/repos/alpha']);
    });

    it('then the most unread', () => {
      const groups = groupByProject(
        [
          makeNotification({ projectPath: '/repos/alpha' }),
          makeNotification({ projectPath: '/repos/beta' }),
          makeNotification({ projectPath: '/repos/beta' }),
        ],
        [],
        []
      );

      expect(groups.map((g) => g.key)).toEqual(['/repos/beta', '/repos/alpha']);
    });

    it('then what is due soonest, with the undated last', () => {
      const groups = groupByProject(
        [],
        [
          makeSchedule({ id: 'a', projectPath: '/repos/alpha', nextDueAt: null }),
          makeSchedule({ id: 'b', projectPath: '/repos/beta', nextDueAt: '2026-08-17 18:00:00' }),
          makeSchedule({ id: 'c', projectPath: '/repos/gamma', nextDueAt: '2026-08-17 13:00:00' }),
        ],
        []
      );

      expect(groups.map((g) => g.key)).toEqual(['/repos/gamma', '/repos/beta', '/repos/alpha']);
    });

    it('falls back to the name so the rail does not shuffle', () => {
      const groups = groupByProject(
        [],
        [],
        [makeStarred('/x/zeta', 'Zeta'), makeStarred('/x/a', 'Alpha')]
      );

      expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Zeta']);
    });
  });
});

describe('upcomingSchedules', () => {
  it('lists what fires next, soonest first', () => {
    const list = upcomingSchedules(
      [
        makeSchedule({ id: 'late', nextDueAt: '2026-08-17 18:00:00' }),
        makeSchedule({ id: 'soon', nextDueAt: '2026-08-17 13:00:00' }),
      ],
      NOW
    );

    expect(list.map((s) => s.id)).toEqual(['soon', 'late']);
  });

  it('leaves out what is off or undated', () => {
    const list = upcomingSchedules(
      [
        makeSchedule({ id: 'off', enabled: false, nextDueAt: '2026-08-17 13:00:00' }),
        makeSchedule({ id: 'undated', nextDueAt: null }),
        makeSchedule({ id: 'on', nextDueAt: '2026-08-17 18:00:00' }),
      ],
      NOW
    );

    expect(list.map((s) => s.id)).toEqual(['on']);
  });

  it('keeps a past-due schedule in the strip', () => {
    const list = upcomingSchedules(
      [makeSchedule({ id: 'overdue', nextDueAt: '2026-08-17 07:00:00' })],
      NOW
    );

    expect(list.map((s) => s.id)).toEqual(['overdue']);
  });

  // A date nobody can read must not be ordered as garbage and take the front
  // of the strip — the same rule `nextDueSchedule` holds in the tray.
  it('drops an entry whose next date cannot be read', () => {
    const list = upcomingSchedules(
      [
        makeSchedule({ id: 'unreadable', nextDueAt: 'sometime next week' }),
        makeSchedule({ id: 'on', nextDueAt: '2026-08-17 18:00:00' }),
      ],
      NOW
    );

    expect(list.map((s) => s.id)).toEqual(['on']);
  });

  it('lists every upcoming schedule unless a limit is given', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeSchedule({ id: `s${i}`, nextDueAt: `2026-08-17 1${i}:00:00` })
    );

    expect(upcomingSchedules(many, NOW)).toHaveLength(9);
    expect(upcomingSchedules(many, NOW, 2).map((s) => s.id)).toEqual(['s0', 's1']);
  });
});

describe('lastRaisedBySchedule', () => {
  it('links a notification to the schedule that raised it', () => {
    const row = makeNotification({ dedupeKey: 'schedule:sched-42:2026-08-17 15:00:00' });

    expect(lastRaisedBySchedule([row]).get('sched-42')).toBe(row);
  });

  it('keeps the newest of several firings', () => {
    const older = makeNotification({
      createdAt: '2026-08-16 15:00:00',
      dedupeKey: 'schedule:sched-42:2026-08-16 15:00:00',
    });
    const newer = makeNotification({
      createdAt: '2026-08-17 15:00:00',
      dedupeKey: 'schedule:sched-42:2026-08-17 15:00:00',
    });

    expect(lastRaisedBySchedule([older, newer]).get('sched-42')).toBe(newer);
    expect(lastRaisedBySchedule([newer, older]).get('sched-42')).toBe(newer);
  });

  // I8: the link is the key, never the origin label — a renamed schedule
  // would otherwise lose its own history.
  it('ignores a row that only carries the schedule’s name', () => {
    const row = makeNotification({ origin: 'sched-42', dedupeKey: null });

    expect(lastRaisedBySchedule([row]).size).toBe(0);
  });
});

describe('centerSummary', () => {
  it('counts unread and open questions across the whole inbox', () => {
    const summary = centerSummary(
      [
        makeNotification({ projectPath: '/repos/alpha' }),
        makeNotification({ projectPath: '/repos/beta', readAt: '2026-08-12 11:00:00' }),
        makeNotification({ projectPath: '/repos/beta', kind: 'ask' }),
      ],
      []
    );

    expect(summary.unread).toBe(2);
    expect(summary.openQuestions).toBe(1);
    expect(summary.schedules).toBe(0);
  });

  it('counts every schedule, on or off', () => {
    const summary = centerSummary(
      [],
      [makeSchedule({ id: 'a' }), makeSchedule({ id: 'b', enabled: false })]
    );

    expect(summary.schedules).toBe(2);
  });

  it('counts nothing when there is nothing', () => {
    expect(centerSummary([], [])).toEqual({
      unread: 0,
      openQuestions: 0,
      schedules: 0,
    });
  });
});

describe('formatCenterSummary', () => {
  // Questions are not in the sentence: the header gives them their own amber
  // badge, and saying the number twice in one row makes both look unsure.
  it('reads as a sentence, leaving questions to the badge', () => {
    expect(formatCenterSummary({ unread: 12, openQuestions: 2, schedules: 5 })).toBe(
      '12 unread · 5 schedules'
    );
  });

  it('gets the singular right', () => {
    expect(formatCenterSummary({ unread: 1, openQuestions: 1, schedules: 1 })).toBe(
      '1 unread · 1 schedule'
    );
  });

  it('drops the parts that are zero', () => {
    expect(formatCenterSummary({ unread: 4, openQuestions: 0, schedules: 2 })).toBe(
      '4 unread · 2 schedules'
    );
  });

  // "0 unread" is the all-clear, and the header would read oddly without it.
  it('still says nothing is unread', () => {
    expect(formatCenterSummary({ unread: 0, openQuestions: 0, schedules: 0 })).toBe('0 unread');
  });

  // The rail below already lists the projects, and it lists idle starred ones
  // too — a number here would disagree with what is on screen.
  it('leaves the project count to the rail', () => {
    expect(formatCenterSummary({ unread: 3, openQuestions: 0, schedules: 0 })).toBe('3 unread');
  });
});

describe('closesCommandCenter', () => {
  function action(overrides: Partial<NotificationAction>): NotificationAction {
    return {
      id: 'a',
      label: 'Go',
      kind: 'open',
      target: { type: 'ticket', ticketId: 't1' },
      ...overrides,
    } as NotificationAction;
  }

  // Everything but answering lands somewhere the overlay covers — the ticket,
  // the file, the terminal of the agent it just started.
  it('closes for the kinds that navigate the IDE', () => {
    expect(closesCommandCenter(action({}))).toBe(true);
    expect(closesCommandCenter({ id: 'a', label: 'Run', kind: 'spawn-agent', task: 'go' })).toBe(
      true
    );
    expect(closesCommandCenter({ id: 'a', label: 'Run', kind: 'command', commandId: 'c' })).toBe(
      true
    );
  });

  // Answering a question is the one action whose result is the row itself.
  it('stays open for an answer', () => {
    expect(closesCommandCenter({ id: 'yes', label: 'Yes', kind: 'answer', value: 'yes' })).toBe(
      false
    );
  });
});
