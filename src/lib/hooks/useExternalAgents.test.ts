// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '@/lib/agents/externalAgents.fixtures.json';
import controlFixtures from '@/lib/agents/agentControl.fixtures.json';
import type { ExternalAgent } from '@/lib/agents/externalAgents';
import { useExternalAgents } from './useExternalAgents';

const invokeMock = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Map<string, (event: { payload: null }) => void>());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: null }) => void) => {
    listeners.set(name, callback);
    return () => listeners.delete(name);
  }),
}));

const entry = controlFixtures.responses.external_list.result.agents[0] as ExternalAgent;

describe('useExternalAgents', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listeners.clear();
  });

  it('mounts empty and takes data when the change event arrives', async () => {
    invokeMock.mockResolvedValue([]);
    const { result, rerender } = renderHook(() => useExternalAgents());
    expect(result.current.externals).toEqual([]);
    await waitFor(() => expect(listeners.has(fixtures.changedEvent)).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith(fixtures.commands.list, undefined);

    invokeMock.mockResolvedValue([entry]);
    act(() => listeners.get(fixtures.changedEvent)!({ payload: null }));
    await waitFor(() => expect(result.current.externals).toEqual([entry]));

    rerender();
    expect(result.current.externals).toEqual([entry]);
  });

  it('keeps one array across renders while nothing changed, so a memo holds', async () => {
    invokeMock.mockResolvedValue([]);
    const { result, rerender } = renderHook(() => useExternalAgents());
    await waitFor(() => expect(listeners.has(fixtures.changedEvent)).toBe(true));
    const before = result.current.externals;
    rerender();
    expect(result.current.externals).toBe(before);
  });

  it('gives an empty list in browser mode and when the registry cannot be read', async () => {
    invokeMock.mockRejectedValue(new Error('registry_unreadable'));
    const { result } = renderHook(() => useExternalAgents());
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(result.current.externals).toEqual([]);
  });

  it('drops an older answer that lands after a newer one', async () => {
    let answerFirst: (rows: ExternalAgent[]) => void = () => {};
    invokeMock.mockReturnValueOnce(
      new Promise<ExternalAgent[]>((resolve) => {
        answerFirst = resolve;
      })
    );
    invokeMock.mockResolvedValue([entry]);
    const { result } = renderHook(() => useExternalAgents());
    await waitFor(() => expect(listeners.has(fixtures.changedEvent)).toBe(true));
    act(() => listeners.get(fixtures.changedEvent)!({ payload: null }));
    await waitFor(() => expect(result.current.externals).toEqual([entry]));

    await act(async () => answerFirst([]));
    expect(result.current.externals).toEqual([entry]);
  });

  it('closes by id, reloads, and lets a failure reach the caller', async () => {
    invokeMock.mockResolvedValue([]);
    const { result } = renderHook(() => useExternalAgents());
    await waitFor(() => expect(listeners.has(fixtures.changedEvent)).toBe(true));

    invokeMock.mockClear();
    await act(() => result.current.closeExternal('ext-1'));
    expect(invokeMock).toHaveBeenNthCalledWith(1, fixtures.commands.close, { id: 'ext-1' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, fixtures.commands.list, undefined);

    invokeMock.mockRejectedValueOnce(new Error('nope'));
    await expect(result.current.closeExternal('ext-1')).rejects.toThrow('nope');
  });
});
