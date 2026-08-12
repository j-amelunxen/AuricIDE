import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

import {
  notificationsAnswer,
  notificationsClear,
  notificationsDispatch,
  notificationsList,
  notificationsMarkAllRead,
  notificationsMarkRead,
  notificationsUnreadCount,
  onNotificationsChanged,
  type NotificationInput,
} from './notifications';

describe('notification IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('dispatches a payload and returns the stored row', async () => {
    const payload: NotificationInput = { source: 'ui', title: 'Hallo' };
    mockInvoke.mockResolvedValueOnce({ id: 1, uid: 'u1', title: 'Hallo' });

    const stored = await notificationsDispatch(payload);

    expect(mockInvoke).toHaveBeenCalledWith('notifications_dispatch', { payload });
    expect(stored).toEqual({ id: 1, uid: 'u1', title: 'Hallo' });
  });

  it('lists with every filter passed through', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await notificationsList({ sinceId: 7, limit: 20, projectPath: '/repo' });
    expect(mockInvoke).toHaveBeenCalledWith('notifications_list', {
      sinceId: 7,
      limit: 20,
      projectPath: '/repo',
    });
  });

  // Rust reads these as Option<T>; leaving them undefined would drop the
  // argument and make the command signature mismatch.
  it('sends explicit nulls for omitted list filters', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await notificationsList();
    expect(mockInvoke).toHaveBeenCalledWith('notifications_list', {
      sinceId: null,
      limit: null,
      projectPath: null,
    });
  });

  it('marks a batch of uids read in one call', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await notificationsMarkRead(['a', 'b']);
    expect(mockInvoke).toHaveBeenCalledWith('notifications_mark_read', { uids: ['a', 'b'] });
  });

  it('scopes mark-all-read to a project when given one', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await notificationsMarkAllRead('/repo');
    expect(mockInvoke).toHaveBeenCalledWith('notifications_mark_all_read', {
      projectPath: '/repo',
    });
  });

  it('falls back to the whole inbox when mark-all-read has no project', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await notificationsMarkAllRead();
    expect(mockInvoke).toHaveBeenCalledWith('notifications_mark_all_read', { projectPath: null });
  });

  it('records an answer against a uid', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await notificationsAnswer('u1', 'yes');
    expect(mockInvoke).toHaveBeenCalledWith('notifications_answer', { uid: 'u1', answer: 'yes' });
  });

  it('returns the unread count', async () => {
    mockInvoke.mockResolvedValueOnce(3);
    expect(await notificationsUnreadCount()).toBe(3);
  });

  it('clears settled notifications', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await notificationsClear('/repo');
    expect(mockInvoke).toHaveBeenCalledWith('notifications_clear', { projectPath: '/repo' });
  });
});

describe('onNotificationsChanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('subscribes to the inbox event', async () => {
    onNotificationsChanged(vi.fn());
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('notifications-changed', expect.any(Function));
    });
  });

  // The event carries no payload on purpose — another process may have written
  // the row, so "go look" is the only thing it can honestly say.
  it('calls the listener with no arguments', async () => {
    const callback = vi.fn();
    mockListen.mockImplementation(
      (_name: string, handler: (event: { payload: unknown }) => void) => {
        handler({ payload: null });
        return Promise.resolve(vi.fn());
      }
    );

    onNotificationsChanged(callback);

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith());
  });
});
