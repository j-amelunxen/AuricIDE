import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { NotificationTray, type NotificationTrayProps } from './NotificationTray';

const NOW = Date.parse('2026-08-17T12:00:00Z');

let uidCounter = 0;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  uidCounter += 1;
  return {
    id: uidCounter,
    uid: `n-${uidCounter}`,
    createdAt: new Date(NOW - 60_000).toISOString(),
    projectPath: '/repos/alpha',
    projectName: 'alpha',
    source: 'system',
    origin: 'Weekly changelog',
    kind: 'info',
    severity: 'info',
    title: `Notification ${uidCounter}`,
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
    id: 'sched-1',
    name: 'Nightly digest',
    enabled: true,
    projectPath: '/repos/alpha',
    projectName: 'alpha',
    specKind: 'every',
    cronExpr: null,
    everyN: 1,
    everyUnit: 'day',
    anchorAt: null,
    timeOfDay: '09:00',
    timezone: 'UTC',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: '2026-08-17 14:00:00',
    createdAt: '2026-08-01 09:00:00',
    updatedAt: '2026-08-01 09:00:00',
    ...overrides,
  };
}

function renderTray(overrides: Partial<NotificationTrayProps> = {}) {
  const props: NotificationTrayProps = {
    pinned: [],
    latest: [],
    hidden: 0,
    hiddenUnread: 0,
    unreadCount: 0,
    status: 'idle',
    nextDue: null,
    scheduleCount: 0,
    now: NOW,
    starredProjects: [],
    parseActions: () => [],
    onOpen: vi.fn(),
    onAction: vi.fn(),
    onOpenCenter: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { ...render(<NotificationTray {...props} />), props };
}

describe('NotificationTray — what the panel shows', () => {
  // I3: a question is a debt. Four newer notifications arrive, the tray only
  // has room for three, and the unanswered ask is still the first thing there.
  it('keeps an unanswered ask above the latest rows, however old it is', () => {
    const ask = makeNotification({
      uid: 'ask-1',
      kind: 'ask',
      title: 'Deploy to staging?',
      createdAt: new Date(NOW - 5 * 86_400_000).toISOString(),
    });
    const latest = [makeNotification(), makeNotification(), makeNotification()];

    renderTray({ pinned: [ask], latest, hidden: 1, hiddenUnread: 1 });

    const rows = screen.getAllByTestId(/^notification-row-/);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute('data-testid', 'notification-row-ask-1');
    expect(rows.map((row) => row.getAttribute('data-testid')).slice(1)).toEqual(
      latest.map((n) => `notification-row-${n.uid}`)
    );
  });

  // I1: the badge answers "how much is waiting for me", not "how much is on
  // screen". Three rows visible, nine unread in the inbox.
  it('badges the whole inbox, not the rows it happens to show', () => {
    renderTray({
      latest: [makeNotification(), makeNotification(), makeNotification()],
      hidden: 6,
      hiddenUnread: 6,
      unreadCount: 9,
    });

    expect(screen.getByTestId('tray-unread-count')).toHaveTextContent('9');
  });

  // I2: a short list must never be mistaken for a quiet inbox.
  it('announces what it truncated, and says how much of it is unread', async () => {
    const user = userEvent.setup();
    const { props } = renderTray({
      latest: [makeNotification()],
      hidden: 12,
      hiddenUnread: 4,
      unreadCount: 5,
    });

    const more = screen.getByTestId('notifications-more');
    expect(more).toHaveTextContent('12 more');
    expect(more).toHaveTextContent('4 unread');

    await user.click(more);
    expect(props.onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('says nothing about truncation when nothing is truncated', () => {
    renderTray({ latest: [makeNotification()], hidden: 0, hiddenUnread: 0, unreadCount: 1 });

    expect(screen.queryByTestId('notifications-more')).toBeNull();
  });

  it('hides the badge when nothing is unread', () => {
    renderTray({ latest: [makeNotification({ readAt: new Date(NOW).toISOString() })] });

    expect(screen.queryByTestId('tray-unread-count')).toBeNull();
  });
});

describe('NotificationTray — the way into the Command Center', () => {
  it('opens it from the header button', async () => {
    const user = userEvent.setup();
    const { props } = renderTray();

    const button = screen.getByTestId('notifications-open-center');
    expect(button).toHaveAccessibleName(/command center/i);
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(button);
    expect(props.onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('opens it from the next-due line, which names the schedule and the count', async () => {
    const user = userEvent.setup();
    const { props } = renderTray({ nextDue: makeSchedule(), scheduleCount: 3 });

    const line = screen.getByTestId('notifications-next-schedule');
    expect(line).toHaveTextContent('Nightly digest');
    expect(line).toHaveTextContent('in 2 h');
    expect(line).toHaveTextContent('3 schedules');

    await user.click(line);
    expect(props.onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('still offers the line when there is nothing scheduled', () => {
    renderTray({ nextDue: null, scheduleCount: 0 });

    expect(screen.getByTestId('notifications-next-schedule')).toHaveTextContent('No schedules');
  });

  it('does not claim there are no schedules when they are merely all off', () => {
    renderTray({ nextDue: null, scheduleCount: 2 });

    const line = screen.getByTestId('notifications-next-schedule');
    expect(line).toHaveTextContent('2 schedules');
    expect(line).toHaveTextContent('none due');
    expect(line).not.toHaveTextContent('No schedules');
  });

  it('counts a single schedule in the singular', () => {
    renderTray({ nextDue: makeSchedule(), scheduleCount: 1 });

    expect(screen.getByTestId('notifications-next-schedule')).toHaveTextContent('1 schedule');
  });
});

describe('NotificationTray — states', () => {
  it('reports a broken inbox rather than an empty one', () => {
    renderTray({ status: 'error' });

    expect(screen.getByTestId('notifications-error')).toBeTruthy();
  });

  it('says the inbox is empty when it is', () => {
    renderTray();

    expect(screen.getByTestId('tray-empty')).toBeTruthy();
  });

  it('shows no empty note while it has rows', () => {
    renderTray({ latest: [makeNotification()] });

    expect(screen.queryByTestId('tray-empty')).toBeNull();
  });

  // The tray and the Command Center are on screen together, and a test id
  // that names both of them points at whichever React rendered first.
  it('names its own badge and empty note, not the full panel’s', () => {
    renderTray({ unreadCount: 2 });

    expect(screen.queryByTestId('notifications-unread-count')).toBeNull();
    expect(screen.queryByTestId('notifications-empty')).toBeNull();
  });
});

describe('NotificationTray — the two blocks say what they are', () => {
  const ask = () => makeNotification({ kind: 'ask', title: 'Deploy to staging?' });

  it('heads the pinned questions with what is being asked of you', () => {
    renderTray({ pinned: [ask()], latest: [makeNotification()] });

    expect(screen.getByTestId('tray-pinned-label')).toHaveTextContent('Needs an answer');
  });

  it('says nothing about questions when there are none', () => {
    renderTray({ latest: [makeNotification()] });

    expect(screen.queryByTestId('tray-pinned-label')).toBeNull();
  });

  // "Latest" is only worth saying as the other side of a divide — above a
  // lone block it labels the whole tray, which the header already did.
  it('marks the ordinary rows off from the questions above them', () => {
    renderTray({ pinned: [ask()], latest: [makeNotification()] });

    expect(screen.getByTestId('tray-latest-label')).toHaveTextContent('Latest');
  });

  it('leaves the latest rows unlabelled when they stand alone', () => {
    renderTray({ latest: [makeNotification()] });

    expect(screen.queryByTestId('tray-latest-label')).toBeNull();
  });

  it('leaves the questions unlabelled as latest when nothing else is there', () => {
    renderTray({ pinned: [ask()] });

    expect(screen.getByTestId('tray-pinned-label')).toBeTruthy();
    expect(screen.queryByTestId('tray-latest-label')).toBeNull();
  });
});

describe('NotificationTray — clicks go back out', () => {
  it('delegates opening a row and running its action', async () => {
    const user = userEvent.setup();
    const notification = makeNotification({ title: 'Nightly run finished' });
    const action = { id: 'run', label: 'Start', kind: 'spawn-agent' as const, task: 'go' };
    const { props } = renderTray({
      latest: [notification],
      parseActions: () => [{ action }],
    });

    await user.click(screen.getByRole('button', { name: /Nightly run finished/ }));
    expect(props.onOpen).toHaveBeenCalledWith(notification.uid);

    await user.click(screen.getByTestId(`notification-action-${notification.uid}-run`));
    expect(props.onAction).toHaveBeenCalledWith(notification, action);
  });

  // The whole point: dismissing right from the tray, no trip to the Command
  // Center required.
  it('delegates dismissing a row without opening it', async () => {
    const user = userEvent.setup();
    const notification = makeNotification({ title: 'Conductor run finished' });
    const { props } = renderTray({ latest: [notification] });

    await user.click(screen.getByTestId(`notification-dismiss-${notification.uid}`));

    expect(props.onDismiss).toHaveBeenCalledWith(notification.uid);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
});

describe('NotificationTray — arrivals are visible as arrivals', () => {
  it('animates a row that appeared, and leaves the ones already there alone', () => {
    const first = makeNotification({ title: 'Was already here' });
    const { rerender, props } = renderTray({ latest: [first] });

    const wrapperOf = (uid: string) =>
      screen.getByTestId(`notification-row-${uid}`).parentElement as HTMLElement;

    // The first paint is not an arrival — the panel just opened.
    expect(wrapperOf(first.uid).className).not.toContain('notification-row-enter');

    const arrived = makeNotification({ title: 'Just landed' });
    rerender(<NotificationTray {...props} latest={[arrived, first]} />);

    expect(wrapperOf(arrived.uid).className).toContain('notification-row-enter');
    expect(wrapperOf(first.uid).className).not.toContain('notification-row-enter');
  });
});
