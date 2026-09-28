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

  it('reports once the listener is registered, not before', async () => {
    let resolveListen: (fn: () => void) => void = () => undefined;
    mockListen.mockImplementation(
      () => new Promise<() => void>((resolve) => (resolveListen = resolve))
    );
    const onListening = vi.fn();

    subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable', onListening);
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    expect(onListening).not.toHaveBeenCalled();

    resolveListen(vi.fn());
    await vi.waitFor(() => expect(onListening).toHaveBeenCalledTimes(1));
  });

  it('does not report listening for a subscription disposed in flight', async () => {
    let resolveListen: (fn: () => void) => void = () => undefined;
    mockListen.mockImplementation(
      () => new Promise<() => void>((resolve) => (resolveListen = resolve))
    );
    const onListening = vi.fn();

    const dispose = subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable', onListening);
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    dispose();
    resolveListen(vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onListening).not.toHaveBeenCalled();
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

  it('warns instead of rejecting when listen itself rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockListen.mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'transformCallback')")
    );

    subscribeToTauriEvent('demo-event', vi.fn(), 'unavailable');

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('unavailable');
    });
    warn.mockRestore();
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
