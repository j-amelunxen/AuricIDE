import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListen = vi.fn().mockResolvedValue(vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

import { subscribeToTauriEvent } from './subscribe';

describe('subscribeToTauriEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('registers a listener for the named event', async () => {
    subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('demo-event', expect.any(Function));
    });
  });

  it('hands the payload to the callback, not the event envelope', async () => {
    const callback = vi.fn();
    mockListen.mockImplementation(
      (_name: string, handler: (event: { payload: unknown }) => void) => {
        handler({ payload: { value: 42 } });
        return Promise.resolve(vi.fn());
      }
    );

    subscribeToTauriEvent('demo-event', callback, 'unavailable');

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith({ value: 42 });
    });
  });

  it('unregisters when the returned function is called', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const unsubscribe = subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    unsubscribe();
    expect(unlisten).toHaveBeenCalled();
  });

  // The lazy import means unsubscribing can beat `listen` resolving. Holding
  // no handle at that point would leave a listener firing for the session.
  it('unregisters a listener that resolves after the caller gave up', async () => {
    const unlisten = vi.fn();
    let resolveListen: (fn: () => void) => void = () => {};
    mockListen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      })
    );

    const unsubscribe = subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());

    unsubscribe();
    resolveListen(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  it('is safe to unsubscribe twice', async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);

    const unsubscribe = subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    unsubscribe();
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('survives an unlisten that throws', async () => {
    mockListen.mockResolvedValue(
      vi.fn(() => {
        throw new Error('already unregistered');
      })
    );

    const unsubscribe = subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    expect(() => unsubscribe()).not.toThrow();
  });
});
