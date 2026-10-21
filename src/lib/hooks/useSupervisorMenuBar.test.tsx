import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { writeMenuBarPrefs } from '@/lib/quickAccess/supervisorMenuBar';
import { saveAuricSkills } from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import { useSupervisorMenuBar } from './useSupervisorMenuBar';
import controlFixtures from '@/lib/agents/agentControl.fixtures.json';

const mockSync = vi.fn();
vi.mock('@/lib/tauri/menuBar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/menuBar')>()),
  menuBarSync: (...args: unknown[]) => mockSync(...args),
}));

let launchListener:
  ((event: { payload: { skillId?: string; newSupervisor?: boolean } }) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: typeof launchListener) => {
    launchListener = handler;
    return () => {
      launchListener = null;
    };
  }),
}));

describe('useSupervisorMenuBar', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSync.mockReset();
    mockSync.mockResolvedValue([]);
    launchListener = null;
  });

  it('syncs the skills and switches, and again when a switch flips', async () => {
    saveSupervisorPresets({
      skills: [{ id: 'p1', label: 'Ping', prompt: 'Say PONG', shortcut: 'Control+Alt+KeyP' }],
      wheelSlots: [],
    });
    saveAuricSkills([{ id: 'vtt', name: 'video to tasklist', prompt: '/video-to-tasklist live' }]);
    renderHook(() => useSupervisorMenuBar(vi.fn()));

    await waitFor(() => expect(mockSync).toHaveBeenCalled());
    expect(mockSync.mock.lastCall?.[0]).toMatchObject({
      tray: false,
      shortcuts: false,
      skills: [
        { id: 'p1', label: 'Ping', shortcut: 'Control+Alt+KeyP' },
        { id: 'auric:vtt', label: 'video to tasklist' },
      ],
    });

    act(() => writeMenuBarPrefs({ tray: true, shortcuts: true }));
    await waitFor(() =>
      expect(mockSync.mock.lastCall?.[0]).toMatchObject({ tray: true, shortcuts: true })
    );
  });

  it('tells the menu bar how many supervisors run, stopped ones and workers not counted', async () => {
    const supervisor = (id: string, status: 'running' | 'idle', startedAt: number) => ({
      id,
      name: id,
      model: 'm',
      provider: 'claude',
      status,
      startedAt,
      role: 'supervisor' as const,
    });
    useStore.setState({
      agents: [
        supervisor('sv-1', 'running', 1),
        supervisor('sv-2', 'running', 2),
        supervisor('sv-0', 'idle', 0),
        { id: 'w', name: 'w', model: 'm', provider: 'claude', status: 'running', startedAt: 3 },
      ],
    });
    renderHook(() => useSupervisorMenuBar(vi.fn()));

    await waitFor(() => expect(mockSync.mock.lastCall?.[0]).toMatchObject({ running: 2 }));
    useStore.setState({ agents: [] });
  });

  it('starts the picked library skill through the supervisor launch', async () => {
    saveAuricSkills([{ id: 'vtt', name: 'video to tasklist', prompt: '/video-to-tasklist live' }]);
    const spawnSupervisor = vi.fn().mockResolvedValue({ kind: 'started', agent: { id: 'sv-1' } });
    const selectAgent = vi.fn();
    useStore.setState({ spawnSupervisor, selectAgent } as never);
    renderHook(() => useSupervisorMenuBar(vi.fn()));

    await waitFor(() => expect(launchListener).not.toBeNull());
    await act(async () => launchListener?.({ payload: { skillId: 'auric:vtt' } }));

    expect(spawnSupervisor).toHaveBeenCalledWith({
      task: '/video-to-tasklist live',
      model: undefined,
    });
    expect(selectAgent).toHaveBeenCalledWith('sv-1');
  });

  it('starts a new supervisor on "Start Supervisor" and opens the newest on "Open Supervisor"', async () => {
    const spawnSupervisor = vi.fn().mockResolvedValue({ kind: 'spawned', agent: { id: 'sv-2' } });
    const selectAgent = vi.fn();
    useStore.setState({ spawnSupervisor, selectAgent } as never);
    renderHook(() => useSupervisorMenuBar(vi.fn()));

    await waitFor(() => expect(launchListener).not.toBeNull());
    // The payloads Rust's menu items emit (agentControl.fixtures.json, supervisors.menuBar).
    const entries = controlFixtures.supervisors.menuBar.items.at(-1)!.entries;
    const payloadOf = (id: string) => entries.find((entry) => entry.id === id)!.payload;
    await act(async () => launchListener?.({ payload: payloadOf('start') }));
    expect(spawnSupervisor).toHaveBeenLastCalledWith({ task: '', forceNew: true });

    await act(async () => launchListener?.({ payload: payloadOf('open') }));
    expect(spawnSupervisor).toHaveBeenLastCalledWith(undefined);
  });
});
