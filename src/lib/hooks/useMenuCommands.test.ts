import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const listeners = new Map<string, (event: { payload: unknown }) => void>();
const mockUnlisten = vi.fn();
const mockListen = vi.fn(
  async (event: string, handler: (e: { payload: unknown }) => void): Promise<() => void> => {
    listeners.set(event, handler);
    return mockUnlisten;
  }
);
const mockInvoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => undefined);

vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

import { useMenuCommands } from './useMenuCommands';

function emit(event: string, payload: unknown) {
  listeners.get(event)?.({ payload });
}

describe('useMenuCommands', () => {
  let onCommand: ReturnType<typeof vi.fn<(commandId: string) => void>>;

  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    onCommand = vi.fn<(commandId: string) => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the command the native menu asked for', async () => {
    renderHook(() => useMenuCommands(onCommand, null));
    await waitFor(() => expect(listeners.has('menu:command')).toBe(true));

    emit('menu:command', 'agent.deploy');

    expect(onCommand).toHaveBeenCalledWith('agent.deploy');
  });

  it('ignores a payload that is not a command id', async () => {
    renderHook(() => useMenuCommands(onCommand, null));
    await waitFor(() => expect(listeners.has('menu:command')).toBe(true));

    emit('menu:command', { nonsense: true });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it('always dispatches to the current handler, not the one from mount', async () => {
    // The handler is rebuilt on nearly every render. Capturing it once would
    // make the menu drive a stale closure — the class of bug where a menu item
    // works but acts on a project the user closed ten minutes ago.
    const { rerender } = renderHook(({ handler }) => useMenuCommands(handler, null), {
      initialProps: { handler: onCommand },
    });
    await waitFor(() => expect(listeners.has('menu:command')).toBe(true));

    const replacement = vi.fn<(commandId: string) => void>();
    rerender({ handler: replacement });
    emit('menu:command', 'file.save');

    expect(onCommand).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith('file.save');
  });

  it('subscribes once and keeps the subscription across re-renders', async () => {
    const { rerender } = renderHook(({ handler }) => useMenuCommands(handler, null), {
      initialProps: { handler: onCommand },
    });
    await waitFor(() => expect(mockListen).toHaveBeenCalledTimes(1));

    rerender({ handler: vi.fn<(commandId: string) => void>() });
    rerender({ handler: vi.fn<(commandId: string) => void>() });

    expect(mockListen).toHaveBeenCalledTimes(1);
  });

  it('tells the menu whether a project is open', async () => {
    const { rerender } = renderHook(({ root }) => useMenuCommands(onCommand, root), {
      initialProps: { root: null as string | null },
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('set_menu_command_states', { projectOpen: false })
    );

    rerender({ root: '/some/project' });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('set_menu_command_states', { projectOpen: true })
    );
  });

  it('drops the subscription on unmount', async () => {
    const { unmount } = renderHook(() => useMenuCommands(onCommand, null));
    await waitFor(() => expect(mockListen).toHaveBeenCalled());

    unmount();

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
