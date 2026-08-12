import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockOnNotificationsChanged = vi.fn();
vi.mock('../tauri/notifications', () => ({
  onNotificationsChanged: (cb: () => void) => mockOnNotificationsChanged(cb),
}));

import { useStore } from '../store';
import { useNotificationInbox } from './useNotificationInbox';

describe('useNotificationInbox', () => {
  let reload: Mock<() => Promise<void>>;
  let drain: Mock<() => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    reload = vi.fn<() => Promise<void>>(async () => undefined);
    drain = vi.fn<() => Promise<void>>(async () => undefined);
    useStore.setState({ reloadNotifications: reload, drainNotifications: drain });
    mockOnNotificationsChanged.mockReturnValue(vi.fn());
  });

  it('loads the inbox once on mount', () => {
    renderHook(() => useNotificationInbox());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('subscribes to inbox changes', () => {
    renderHook(() => useNotificationInbox());
    expect(mockOnNotificationsChanged).toHaveBeenCalledWith(expect.any(Function));
  });

  it('drains when another process writes to the inbox', () => {
    renderHook(() => useNotificationInbox());
    const listener = mockOnNotificationsChanged.mock.calls[0][0] as () => void;

    listener();

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    mockOnNotificationsChanged.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useNotificationInbox());
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  // A dropped file event leaves the list quietly behind, and returning to the
  // window is the moment the user trusts what it shows.
  it('drains again when the window regains focus', () => {
    renderHook(() => useNotificationInbox());
    drain.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('stops listening for focus after unmount', () => {
    const { unmount } = renderHook(() => useNotificationInbox());
    unmount();
    drain.mockClear();

    window.dispatchEvent(new Event('focus'));

    expect(drain).not.toHaveBeenCalled();
  });
});
