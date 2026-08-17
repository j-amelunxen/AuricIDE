import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand';
import type { Notification } from '@/lib/notifications/types';

const mockDispatch = vi.fn();
const mockList = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockAnswer = vi.fn();
const mockClear = vi.fn();

// The banner itself is os.ts's business and tested there; what matters here is
// which arrivals reach it at all.
const mockNotifyOs = vi.fn<(title: string, body: string) => Promise<void>>(async () => undefined);

vi.mock('@/lib/notifications/os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications/os')>();
  return { ...actual, notifyOs: (title: string, body: string) => mockNotifyOs(title, body) };
});

vi.mock('@/lib/tauri/notifications', () => ({
  notificationsDispatch: (...args: unknown[]) => mockDispatch(...args),
  notificationsList: (...args: unknown[]) => mockList(...args),
  notificationsMarkRead: (...args: unknown[]) => mockMarkRead(...args),
  notificationsMarkAllRead: (...args: unknown[]) => mockMarkAllRead(...args),
  notificationsAnswer: (...args: unknown[]) => mockAnswer(...args),
  notificationsClear: (...args: unknown[]) => mockClear(...args),
}));

import {
  createNotificationsSlice,
  getVisibleNotifications,
  mergeNotifications,
  type NotificationsSlice,
} from './notificationsSlice';

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

describe('notificationsSlice', () => {
  let store: StoreApi<NotificationsSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    rowId = 0;
    mockList.mockResolvedValue([]);
    mockDispatch.mockImplementation(async (payload: Record<string, unknown>) =>
      makeNotification({ title: payload.title as string, uid: 'stored-uid' })
    );
    mockMarkRead.mockResolvedValue(undefined);
    mockMarkAllRead.mockResolvedValue(undefined);
    mockAnswer.mockResolvedValue(undefined);
    mockClear.mockResolvedValue(undefined);
    store = createStore<NotificationsSlice>()((...a) => ({ ...createNotificationsSlice(...a) }));
  });

  describe('dispatchNotification', () => {
    it('shows the row the backend stored, not the input', async () => {
      await store.getState().dispatchNotification({ source: 'ui', title: 'Hallo' });

      const [only] = store.getState().notifications;
      expect(only.uid).toBe('stored-uid');
      expect(store.getState().notificationsUnreadCount).toBe(1);
    });

    it('advances the drain cursor to the stored id', async () => {
      mockDispatch.mockResolvedValueOnce(makeNotification({ id: 42 }));
      await store.getState().dispatchNotification({ source: 'ui', title: 'Hallo' });
      expect(store.getState().notificationsCursor).toBe(42);
    });

    // Without a backend the message must still surface. Dropping it would
    // defeat the point of an inbox.
    it('keeps the notification locally when the backend is unavailable', async () => {
      mockDispatch.mockRejectedValueOnce(new Error('browser mode'));

      const result = await store.getState().dispatchNotification({ source: 'ui', title: 'Hallo' });

      expect(result).toBeNull();
      expect(store.getState().notifications).toHaveLength(1);
      expect(store.getState().notificationsUnreadCount).toBe(1);
    });

    it('never lets a local-only row move the cursor', async () => {
      mockDispatch.mockRejectedValueOnce(new Error('browser mode'));
      await store.getState().dispatchNotification({ source: 'ui', title: 'Hallo' });
      expect(store.getState().notificationsCursor).toBe(0);
    });
  });

  describe('drainNotifications', () => {
    it('asks only for rows past the cursor', async () => {
      store.setState({ notificationsCursor: 9 });
      await store.getState().drainNotifications();
      expect(mockList).toHaveBeenCalledWith({ sinceId: 9 });
    });

    it('merges incoming rows and advances the cursor', async () => {
      mockList.mockResolvedValueOnce([makeNotification({ id: 5 }), makeNotification({ id: 7 })]);
      await store.getState().drainNotifications();

      expect(store.getState().notifications).toHaveLength(2);
      expect(store.getState().notificationsCursor).toBe(7);
    });

    it('leaves the list untouched when nothing is new', async () => {
      const before = store.getState().notifications;
      await store.getState().drainNotifications();
      expect(store.getState().notifications).toBe(before);
    });

    it('records an error status when the drain fails', async () => {
      mockList.mockRejectedValueOnce(new Error('nope'));
      await store.getState().drainNotifications();
      expect(store.getState().notificationsStatus).toBe('error');
    });

    // A schedule fires in Rust, so it never passes dispatchNotification. This
    // is the only place its banner can be raised — without it, a reminder that
    // arrives while the window is in the background says nothing at all.
    it('raises a banner for what just arrived', async () => {
      mockList.mockResolvedValueOnce([
        makeNotification({ id: 5, source: 'system', title: 'Weekly changelog' }),
      ]);

      await store.getState().drainNotifications();

      expect(mockNotifyOs).toHaveBeenCalledWith('Weekly changelog', '');
    });

    it('raises one counted banner rather than a stack of them', async () => {
      mockList.mockResolvedValueOnce([
        makeNotification({ id: 5, source: 'system', title: 'Backup' }),
        makeNotification({ id: 6, source: 'system', title: 'Changelog' }),
      ]);

      await store.getState().drainNotifications();

      expect(mockNotifyOs).toHaveBeenCalledTimes(1);
      expect(mockNotifyOs).toHaveBeenCalledWith('2 new notifications', 'Backup · Changelog');
    });

    it('stays quiet for arrivals that have not earned a banner', async () => {
      mockList.mockResolvedValueOnce([makeNotification({ id: 5, source: 'agent' })]);
      await store.getState().drainNotifications();
      expect(mockNotifyOs).not.toHaveBeenCalled();
    });
  });

  describe('reloadNotifications', () => {
    // It reads the whole table. Banners here would announce a week of history
    // on every start.
    it('raises no banner for history it is only re-reading', async () => {
      mockList.mockResolvedValueOnce([makeNotification({ id: 4, source: 'system' })]);
      await store.getState().reloadNotifications();
      expect(mockNotifyOs).not.toHaveBeenCalled();
    });

    it('replaces the list and rebuilds the cursor', async () => {
      store.setState({ notifications: [makeNotification()], notificationsCursor: 99 });
      mockList.mockResolvedValueOnce([makeNotification({ id: 4 })]);

      await store.getState().reloadNotifications();

      expect(store.getState().notifications).toHaveLength(1);
      expect(store.getState().notificationsCursor).toBe(4);
      expect(store.getState().notificationsStatus).toBe('idle');
    });
  });

  describe('markNotificationRead', () => {
    it('drops the unread count and persists', async () => {
      const row = makeNotification();
      store.setState({ notifications: [row], notificationsUnreadCount: 1 });

      await store.getState().markNotificationRead(row.uid);

      expect(store.getState().notificationsUnreadCount).toBe(0);
      expect(mockMarkRead).toHaveBeenCalledWith([row.uid]);
    });

    it('does nothing for an already-read row', async () => {
      const row = makeNotification({ readAt: '2026-08-12 09:00:00' });
      store.setState({ notifications: [row] });

      await store.getState().markNotificationRead(row.uid);

      expect(mockMarkRead).not.toHaveBeenCalled();
    });

    it('stays read when persisting fails', async () => {
      mockMarkRead.mockRejectedValueOnce(new Error('nope'));
      const row = makeNotification();
      store.setState({ notifications: [row], notificationsUnreadCount: 1 });

      await store.getState().markNotificationRead(row.uid);

      expect(store.getState().notifications[0].readAt).not.toBeNull();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('zeroes the count across projects', async () => {
      store.setState({
        notifications: [
          makeNotification({ projectPath: '/a' }),
          makeNotification({ projectPath: '/b' }),
        ],
        notificationsUnreadCount: 2,
      });

      await store.getState().markAllNotificationsRead();

      expect(store.getState().notificationsUnreadCount).toBe(0);
      expect(mockMarkAllRead).toHaveBeenCalled();
    });
  });

  describe('answerNotification', () => {
    it('records the choice and counts as read', async () => {
      const row = makeNotification({ kind: 'ask' });
      store.setState({ notifications: [row], notificationsUnreadCount: 1 });

      await store.getState().answerNotification(row.uid, 'yes');

      const answered = store.getState().notifications[0];
      expect(answered.answer).toBe('yes');
      expect(answered.answeredAt).not.toBeNull();
      expect(answered.readAt).not.toBeNull();
      expect(store.getState().notificationsUnreadCount).toBe(0);
      expect(mockAnswer).toHaveBeenCalledWith(row.uid, 'yes');
    });

    // A waiting agent has already read the first reply back; a second one
    // would leave it guessing which is live.
    it('refuses to answer a settled question twice', async () => {
      const row = makeNotification({
        kind: 'ask',
        answeredAt: '2026-08-12 09:00:00',
        answer: 'yes',
      });
      store.setState({ notifications: [row] });

      await store.getState().answerNotification(row.uid, 'no');

      expect(store.getState().notifications[0].answer).toBe('yes');
      expect(mockAnswer).not.toHaveBeenCalled();
    });
  });

  describe('clearNotifications', () => {
    it('spares an unanswered question', async () => {
      store.setState({
        notifications: [
          makeNotification({ kind: 'ask', title: 'offen' }),
          makeNotification({ kind: 'info', title: 'info' }),
          makeNotification({
            kind: 'ask',
            title: 'beantwortet',
            answeredAt: '2026-08-12 09:00:00',
          }),
        ],
      });

      await store.getState().clearNotifications();

      expect(store.getState().notifications.map((n) => n.title)).toEqual(['offen']);
      expect(mockClear).toHaveBeenCalled();
    });
  });

  describe('the project filter hides rows without changing any count', () => {
    beforeEach(() => {
      store.setState({
        notifications: [
          makeNotification({ projectPath: '/a' }),
          makeNotification({ projectPath: '/b' }),
        ],
        notificationsUnreadCount: 2,
      });
    });

    it('narrows what the panel shows', () => {
      store.getState().setNotificationsProjectFilter('/a');
      expect(getVisibleNotifications(store.getState())).toHaveLength(1);
    });

    it('leaves the unread count describing the whole inbox', () => {
      store.getState().setNotificationsProjectFilter('/a');
      expect(store.getState().notificationsUnreadCount).toBe(2);
    });

    it('shows everything again when cleared', () => {
      store.getState().setNotificationsProjectFilter('/a');
      store.getState().setNotificationsProjectFilter(null);
      expect(getVisibleNotifications(store.getState())).toHaveLength(2);
    });
  });
});

describe('mergeNotifications', () => {
  beforeEach(() => {
    rowId = 0;
  });

  it('sorts newest first', () => {
    const older = makeNotification({ createdAt: '2026-08-12 10:00:00' });
    const newer = makeNotification({ createdAt: '2026-08-12 11:00:00' });
    expect(mergeNotifications([older], [newer]).map((n) => n.uid)).toEqual([newer.uid, older.uid]);
  });

  it('replaces a row that shares a uid', () => {
    const existing = makeNotification({ uid: 'same', title: 'alt' });
    const incoming = makeNotification({ uid: 'same', title: 'neu' });

    const merged = mergeNotifications([existing], [incoming]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('neu');
  });

  // A bump written by another process arrives under a uid this client has
  // never seen; without the dedupe-key check the old row would linger.
  it('replaces a row that shares a dedupe key even under a different uid', () => {
    const existing = makeNotification({ uid: 'old', dedupeKey: 'schedule:1', title: 'alt' });
    const incoming = makeNotification({ uid: 'new', dedupeKey: 'schedule:1', title: 'neu' });

    const merged = mergeNotifications([existing], [incoming]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('neu');
  });

  it('keeps rows whose dedupe key is null apart', () => {
    const a = makeNotification({ dedupeKey: null });
    const b = makeNotification({ dedupeKey: null });
    expect(mergeNotifications([a], [b])).toHaveLength(2);
  });

  it('returns the same list when nothing comes in', () => {
    const existing = [makeNotification()];
    expect(mergeNotifications(existing, [])).toBe(existing);
  });
});
