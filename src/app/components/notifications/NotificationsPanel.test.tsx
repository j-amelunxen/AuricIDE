import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import { NotificationsPanel, type NotificationsPanelProps } from './NotificationsPanel';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

let seq = 0;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  seq += 1;
  return {
    id: seq,
    uid: `u${seq}`,
    createdAt: '2026-08-12 11:59:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: `Meldung ${seq}`,
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

function renderPanel(overrides: Partial<NotificationsPanelProps> = {}) {
  const props: NotificationsPanelProps = {
    notifications: [],
    unreadCount: 0,
    status: 'idle',
    projectFilter: null,
    now: NOW,
    parseActions: (n) => ((n.actions as NotificationAction[]) ?? []).map((action) => ({ action })),
    onOpen: vi.fn(),
    onAction: vi.fn(),
    onSetProjectFilter: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<NotificationsPanel {...props} />);
  return props;
}

describe('NotificationsPanel', () => {
  it('names what the inbox is for when it is empty', () => {
    renderPanel();
    expect(screen.getByTestId('notifications-empty').textContent).toBe(
      'Inbox empty. Agents, schedules, and the Conductor report here.'
    );
  });

  it('renders one row per notification', () => {
    const a = makeNotification();
    const b = makeNotification();
    renderPanel({ notifications: [a, b] });

    expect(screen.getByTestId(`notification-row-${a.uid}`)).toBeTruthy();
    expect(screen.getByTestId(`notification-row-${b.uid}`)).toBeTruthy();
  });

  it('reports the row that was opened', () => {
    const row = makeNotification();
    const props = renderPanel({ notifications: [row] });

    fireEvent.click(screen.getByTestId(`notification-row-${row.uid}`).querySelector('button')!);

    expect(props.onOpen).toHaveBeenCalledWith(row.uid);
  });

  describe('the header count', () => {
    it('shows the unread total it was handed', () => {
      renderPanel({ notifications: [makeNotification()], unreadCount: 7 });
      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('7');
    });

    it('is hidden when nothing is unread', () => {
      renderPanel({ notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' })] });
      expect(screen.queryByTestId('notifications-unread-count')).toBeNull();
    });

    // The rule that keeps the badge trustworthy: filters hide rows, they never
    // change the number. A count that shrank with a filter would be unusable
    // as a reason to look.
    it('does not shrink when a project filter hides rows', () => {
      renderPanel({
        notifications: [
          makeNotification({ projectPath: '/a' }),
          makeNotification({ projectPath: '/b' }),
        ],
        unreadCount: 2,
        projectFilter: '/a',
      });

      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('2');
      expect(screen.getAllByTestId(/^notification-row-/)).toHaveLength(1);
    });

    it('does not shrink when the unread filter hides rows', () => {
      renderPanel({
        notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' }), makeNotification()],
        unreadCount: 1,
      });

      fireEvent.click(screen.getByTestId('notifications-filter-unread'));

      expect(screen.getByTestId('notifications-unread-count').textContent).toBe('1');
    });
  });

  describe('filters', () => {
    it('narrows to unread rows', () => {
      renderPanel({
        notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' }), makeNotification()],
      });

      fireEvent.click(screen.getByTestId('notifications-filter-unread'));

      expect(screen.getAllByTestId(/^notification-row-/)).toHaveLength(1);
    });

    // A short list must never be mistaken for an empty inbox.
    it('says how many rows a filter is hiding', () => {
      renderPanel({
        notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' }), makeNotification()],
      });

      fireEvent.click(screen.getByTestId('notifications-filter-unread'));

      expect(screen.getByTestId('notifications-hidden-note').textContent).toBe(
        '1 hidden by filters'
      );
    });

    it('labels the filter chips in English', () => {
      renderPanel({
        notifications: [
          makeNotification({ projectPath: '/a', projectName: 'alpha' }),
          makeNotification({ projectPath: '/b', projectName: 'beta' }),
        ],
      });

      expect(screen.getByTestId('notifications-filter-all').textContent).toBe('All');
      expect(screen.getByTestId('notifications-filter-unread').textContent).toBe('Unread');
      expect(screen.getByTestId('notifications-project-all').textContent).toBe('All projects');
    });

    it('reports a project choice upward', () => {
      const props = renderPanel({
        notifications: [
          makeNotification({ projectPath: '/a', projectName: 'alpha' }),
          makeNotification({ projectPath: '/b', projectName: 'beta' }),
        ],
      });

      fireEvent.click(screen.getByTestId('notifications-project-beta'));

      expect(props.onSetProjectFilter).toHaveBeenCalledWith('/b');
    });

    // One project is not a choice; the chips would be noise.
    it('offers no project chips while everything is from one project', () => {
      renderPanel({
        notifications: [makeNotification({ projectPath: '/a', projectName: 'alpha' })],
      });
      expect(screen.queryByTestId('notifications-project-all')).toBeNull();
    });

    it('explains an empty result differently from an empty inbox', () => {
      renderPanel({ notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' })] });

      fireEvent.click(screen.getByTestId('notifications-filter-unread'));

      expect(screen.getByTestId('notifications-empty').textContent).toBe(
        'Nothing in this selection.'
      );
    });
  });

  describe('bulk controls', () => {
    it('names the mark-all-read button', () => {
      renderPanel({ notifications: [makeNotification()], unreadCount: 1 });
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeTruthy();
    });

    it('marks everything read', () => {
      const props = renderPanel({ notifications: [makeNotification()], unreadCount: 1 });
      fireEvent.click(screen.getByTestId('notifications-mark-all-read'));
      expect(props.onMarkAllRead).toHaveBeenCalled();
    });

    it('disables mark-all-read when there is nothing unread', () => {
      renderPanel({ notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' })] });
      expect(screen.getByTestId<HTMLButtonElement>('notifications-mark-all-read').disabled).toBe(
        true
      );
    });

    it('clears the inbox', () => {
      const props = renderPanel({ notifications: [makeNotification()] });
      fireEvent.click(screen.getByTestId('notifications-clear'));
      expect(props.onClear).toHaveBeenCalled();
    });

    // Clear is a labeled button, not an icon with a title. The hint still
    // explains that open questions stay.
    it('exposes Clear as a labeled button', () => {
      renderPanel({ notifications: [makeNotification()] });
      const clear = screen.getByRole('button', { name: 'Clear' });
      expect(clear.textContent).toContain('Clear');
      expect(clear.getAttribute('title')).toBe('Clear done items. Open questions stay.');
    });
  });

  it('says so when the inbox could not be read', () => {
    renderPanel({ status: 'error' });
    expect(screen.getByTestId('notifications-error').textContent).toBe(
      'Inbox could not be read. It will retry when you come back to this window.'
    );
  });
});

describe('NotificationRow', () => {
  it('marks an unread row', () => {
    const row = makeNotification();
    renderPanel({ notifications: [row] });

    expect(screen.getByTestId(`notification-row-${row.uid}`).dataset.unread).toBe('true');
    expect(screen.getByLabelText('unread')).toBeTruthy();
  });

  it('drops the dot once read', () => {
    renderPanel({ notifications: [makeNotification({ readAt: '2026-08-12 11:00:00' })] });
    expect(screen.queryByTestId('notification-unread-dot')).toBeNull();
  });

  it('shows body, project and age', () => {
    renderPanel({
      notifications: [
        makeNotification({
          body: 'Der Scan ist fehlgeschlagen',
          projectName: 'sample-project',
          createdAt: '2026-08-12 11:00:00',
        }),
      ],
    });

    expect(screen.getByText('Der Scan ist fehlgeschlagen')).toBeTruthy();
    expect(screen.getByText('sample-project')).toBeTruthy();
    expect(screen.getByText('1h')).toBeTruthy();
  });

  it('renders a button per action and reports the click', () => {
    const action: NotificationAction = {
      id: 'run',
      label: 'Agent starten',
      kind: 'spawn-agent',
      task: 'scan',
    };
    const row = makeNotification({ kind: 'ask', actions: [action] });
    const props = renderPanel({ notifications: [row] });

    fireEvent.click(screen.getByTestId(`notification-action-${row.uid}-run`));

    expect(props.onAction).toHaveBeenCalledWith(row, action);
  });

  it('disables an action that arrives with a disabledReason', () => {
    const action: NotificationAction = {
      id: 'run',
      label: 'Changelog starten',
      kind: 'run-skill',
      skillId: 's1',
      skillLabel: 'Changelog',
      prompt: '/changelog',
      repoPath: '/gone',
    };
    const row = makeNotification({ actions: [action] });
    renderPanel({
      notifications: [row],
      parseActions: () => [{ action, disabledReason: 'Projektordner nicht gefunden' }],
    });

    const button = screen.getByTestId<HTMLButtonElement>(`notification-action-${row.uid}-run`);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Projektordner nicht gefunden');
  });

  describe('a settled question', () => {
    const action: NotificationAction = {
      id: 'yes',
      label: 'Ja, starten',
      kind: 'answer',
      value: 'y',
    };
    const settled = () =>
      makeNotification({
        kind: 'ask',
        actions: [action],
        answeredAt: '2026-08-12 11:30:00',
        answer: 'yes',
      });

    // Answering twice would leave a waiting agent guessing which reply is live.
    it('offers no buttons any more', () => {
      const row = settled();
      renderPanel({ notifications: [row] });
      expect(screen.queryByTestId(`notification-action-${row.uid}-yes`)).toBeNull();
    });

    it('shows which answer was given', () => {
      const row = settled();
      renderPanel({ notifications: [row] });
      expect(screen.getByTestId(`notification-answered-${row.uid}`).textContent).toContain(
        'Ja, starten'
      );
    });
  });

  // An info row's buttons are navigation, and navigating twice is fine.
  it('keeps the buttons on an answered-looking info row', () => {
    const action: NotificationAction = {
      id: 'open',
      label: 'Öffnen',
      kind: 'open',
      target: { type: 'goal', goalId: 'g1' },
    };
    const row = makeNotification({ kind: 'info', actions: [action] });
    renderPanel({ notifications: [row] });

    expect(screen.getByTestId(`notification-action-${row.uid}-open`)).toBeTruthy();
  });

  // Rejected actions arrive here as an empty list; the row must still render.
  it('renders a row whose actions were all rejected', () => {
    const row = makeNotification({ actions: [{ kind: 'exec' }] });
    renderPanel({ notifications: [row], parseActions: () => [] });

    expect(screen.getByTestId(`notification-row-${row.uid}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /exec/i })).toBeNull();
  });
});
