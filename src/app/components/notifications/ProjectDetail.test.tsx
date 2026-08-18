import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { ProjectDetail, type ProjectDetailProps } from './ProjectDetail';

const NOW = Date.parse('2026-08-12T10:00:00.000Z');

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security-Scan',
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
    nextDueAt: '2026-08-12 12:00:00',
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

let uid = 0;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  uid += 1;
  return {
    id: uid,
    uid: `n-${uid}`,
    createdAt: '2026-08-12 09:00:00',
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: 'Something happened',
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

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    key: '/repo/alpha',
    path: '/repo/alpha',
    label: 'alpha',
    notifications: [],
    unread: 0,
    openQuestions: 0,
    schedules: [],
    nextDueAt: null,
    ...overrides,
  };
}

function renderDetail(overrides: Partial<ProjectDetailProps> = {}) {
  const props: ProjectDetailProps = {
    group: null,
    groups: [],
    notifications: [],
    totals: { unread: 0, openQuestions: 0 },
    status: 'idle',
    now: NOW,
    starredProjects: [],
    lastRaised: new Map(),
    parseActions: () => [],
    onOpen: vi.fn(),
    onAction: vi.fn(),
    onNewSchedule: vi.fn(),
    onEditSchedule: vi.fn(),
    onToggleSchedule: vi.fn(),
    onDeleteSchedule: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClear: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<ProjectDetail {...props} />);
  return props;
}

describe('ProjectDetail', () => {
  describe('the heading', () => {
    // The unread number is already on the panel's own badge a few pixels
    // below. Said twice, one of them stops being read and both stop being
    // trusted — so the heading keeps the part the badge does not carry.
    it('names the selected project and what it is waiting on', () => {
      renderDetail({
        group: makeGroup({
          notifications: [makeNotification()],
          unread: 3,
          openQuestions: 1,
          schedules: [makeSchedule()],
        }),
      });

      const heading = screen.getByTestId('command-center-detail-heading');
      expect(heading.textContent).toContain('alpha');
      expect(heading.textContent).toContain('1 question waiting');
      expect(heading.textContent).not.toContain('unread');
      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('3');
    });

    // I1: with nothing selected the heading describes the whole inbox, not
    // whichever rows happen to be on screen.
    it('describes the whole inbox under All', () => {
      renderDetail({
        notifications: [makeNotification()],
        totals: { unread: 12, openQuestions: 2 },
      });

      const heading = screen.getByTestId('command-center-detail-heading');
      expect(heading.textContent).toContain('All projects');
      expect(heading.textContent).toContain('2 questions waiting');
      expect(heading.textContent).not.toContain('unread');
      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('12');
    });

    it('says nothing when no question is waiting', () => {
      renderDetail({ group: makeGroup({ unread: 3 }) });

      expect(screen.queryByTestId('command-center-detail-questions')).toBeNull();
    });
  });

  describe('the triggers section', () => {
    it('lists the project’s schedules', () => {
      renderDetail({ group: makeGroup({ schedules: [makeSchedule()] }) });

      expect(screen.getByTestId('command-center-triggers')).toBeTruthy();
      expect(screen.getByTestId('schedule-row-s1')).toBeTruthy();
      expect(screen.getByTestId('schedule-next-s1').textContent).toBe('in 2 h');
    });

    it('says when a schedule last raised something', () => {
      renderDetail({
        group: makeGroup({ schedules: [makeSchedule()] }),
        lastRaised: new Map([['s1', makeNotification({ createdAt: '2026-08-12 08:00:00' })]]),
      });

      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toContain('2h');
    });

    it('offers a new schedule for this project', () => {
      const props = renderDetail({ group: makeGroup() });

      fireEvent.click(screen.getByTestId('command-center-new-schedule-here'));

      expect(props.onNewSchedule).toHaveBeenCalled();
    });

    it('explains the catch-up model when a project has no schedules', () => {
      renderDetail({ group: makeGroup() });

      expect(screen.getByTestId('schedules-empty')).toBeTruthy();
    });

    it('passes an edit, a toggle and a delete straight through', () => {
      const schedule = makeSchedule();
      const props = renderDetail({ group: makeGroup({ schedules: [schedule] }) });

      fireEvent.click(screen.getByTestId('schedule-edit-s1'));
      fireEvent.click(screen.getByTestId('schedule-toggle-s1'));
      fireEvent.click(screen.getByTestId('schedule-delete-s1'));

      expect(props.onEditSchedule).toHaveBeenCalledWith(schedule);
      expect(props.onToggleSchedule).toHaveBeenCalledWith(schedule, false);
      expect(props.onDeleteSchedule).toHaveBeenCalledWith(schedule);
    });

    // Under All the triggers of every project are one list, so each run of
    // rows has to say whose it is.
    it('groups every project’s triggers by label under All', () => {
      renderDetail({
        groups: [
          makeGroup({ schedules: [makeSchedule()] }),
          makeGroup({
            key: '/repo/beta',
            path: '/repo/beta',
            label: 'beta',
            schedules: [makeSchedule({ id: 's2', projectPath: '/repo/beta', projectName: 'beta' })],
          }),
          makeGroup({ key: '/repo/gamma', path: '/repo/gamma', label: 'gamma' }),
        ],
      });

      expect(screen.getByTestId('schedules-group-alpha')).toBeTruthy();
      expect(screen.getByTestId('schedules-group-beta')).toBeTruthy();
      // A project with no triggers contributes no heading — an empty group
      // heading is a row that says nothing.
      expect(screen.queryByTestId('schedules-group-gamma')).toBeNull();
    });
  });

  describe('the notifications section', () => {
    it('shows only the selected project’s rows', () => {
      const mine = makeNotification({ title: 'Alpha row' });
      renderDetail({
        group: makeGroup({ notifications: [mine], unread: 1 }),
        notifications: [mine, makeNotification({ projectPath: '/repo/beta', title: 'Beta row' })],
      });

      expect(screen.getByTestId(`notification-row-${mine.uid}`)).toBeTruthy();
      expect(screen.getByText('Alpha row')).toBeTruthy();
      expect(screen.queryByText('Beta row')).toBeNull();
    });

    it('shows the whole inbox under All', () => {
      const rows = [makeNotification({ title: 'Alpha row' })];
      renderDetail({ notifications: rows, totals: { unread: 1, openQuestions: 0 } });

      expect(screen.getByText('Alpha row')).toBeTruthy();
    });

    // I1 again, one layer down: the panel's own badge is the project's unread,
    // never the count of rows it happens to be rendering.
    it('counts the project’s unread, not the rows on screen', () => {
      renderDetail({
        group: makeGroup({ notifications: [makeNotification({ readAt: null })], unread: 4 }),
      });

      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('4');
    });

    it('passes mark-all-read and clear through', () => {
      const props = renderDetail({
        group: makeGroup({ notifications: [makeNotification()], unread: 1 }),
      });

      fireEvent.click(screen.getByTestId('notifications-mark-all-read'));
      fireEvent.click(screen.getByTestId('notifications-clear'));

      expect(props.onMarkAllRead).toHaveBeenCalled();
      expect(props.onClear).toHaveBeenCalled();
    });

    // The rail IS the project filter here. A second one inside the panel would
    // be two controls for one decision, and only one of them visible.
    it('offers no project chips of its own', () => {
      renderDetail({
        notifications: [
          makeNotification(),
          makeNotification({ projectPath: '/repo/beta', projectName: 'beta' }),
        ],
        totals: { unread: 2, openQuestions: 0 },
      });

      expect(screen.queryByTestId('notifications-project-all')).toBeNull();
    });

    // I5: a question that has been answered shows the answer, never buttons
    // that could answer it a second time.
    it('renders a settled ask as its answer', () => {
      const settled = makeNotification({
        kind: 'ask',
        title: 'Deploy?',
        answeredAt: '2026-08-12 09:30:00',
        answer: 'yes',
      });
      renderDetail({
        group: makeGroup({ notifications: [settled] }),
        parseActions: () => [
          { action: { id: 'yes', label: 'Deploy it', kind: 'answer', value: 'yes' } },
        ],
      });

      expect(screen.getByTestId(`notification-answered-${settled.uid}`).textContent).toContain(
        'Deploy it'
      );
      expect(screen.queryByTestId(`notification-action-${settled.uid}-yes`)).toBeNull();
    });
  });
});
