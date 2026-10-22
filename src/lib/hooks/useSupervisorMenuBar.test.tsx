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

const mockRegistry = vi.fn();
vi.mock('@/lib/tauri/supervisorManagers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/supervisorManagers')>()),
  managerRegistry: () => mockRegistry(),
}));

let launchListener:
  | ((event: {
      payload: { skillId?: string; managerKey?: string; newSupervisor?: boolean };
    }) => void)
  | null = null;
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
    mockRegistry.mockReset();
    mockRegistry.mockResolvedValue({ managers: [], error: null });
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

  describe('Project Managers', () => {
    const manager = (key: string, name: string, archivedAt: string | null = null) => ({
      key,
      name,
      runDir: `2026-10-21_${key}`,
      promotedAt: '2026-10-21T09:00:00Z',
      archivedAt,
      lastLaunch: null,
    });

    it('syncs the non-archived managers set to show, with a running flag and shortcut', async () => {
      localStorage.setItem(
        'auric.supervisor.managers',
        JSON.stringify({
          'release-desk': { shortcut: 'Control+Alt+KeyR' },
          hidden: { menuBar: false },
        })
      );
      mockRegistry.mockResolvedValue({
        managers: [
          manager('release-desk', 'Release Desk'),
          manager('hidden', 'Hidden'),
          manager('old', 'Old', '2026-10-22T00:00:00Z'),
        ],
        error: null,
      });
      useStore.setState({
        agents: [
          {
            id: 'sv-1',
            name: 'sv-1',
            model: 'm',
            provider: 'claude',
            status: 'running',
            startedAt: 1,
            role: 'supervisor',
            supervisorKey: 'release-desk',
          },
        ],
      } as never);
      renderHook(() => useSupervisorMenuBar(vi.fn()));

      await waitFor(() =>
        expect(mockSync.mock.lastCall?.[0].managers).toEqual([
          {
            key: 'release-desk',
            label: 'Release Desk',
            running: true,
            shortcut: 'Control+Alt+KeyR',
          },
        ])
      );
      useStore.setState({ agents: [] });
    });

    it('opens the picked manager by its key', async () => {
      const spawnSupervisor = vi.fn().mockResolvedValue({ kind: 'spawned', agent: { id: 'sv-3' } });
      const selectAgent = vi.fn();
      useStore.setState({ spawnSupervisor, selectAgent } as never);
      renderHook(() => useSupervisorMenuBar(vi.fn()));

      await waitFor(() => expect(launchListener).not.toBeNull());
      await act(async () => launchListener?.({ payload: { managerKey: 'release-desk' } }));

      expect(spawnSupervisor).toHaveBeenCalledWith({ task: '', managerKey: 'release-desk' });
      expect(selectAgent).toHaveBeenCalledWith('sv-3');
    });

    it('names the manager when macOS refuses its shortcut', async () => {
      const showToast = vi.fn();
      useStore.setState({ showToast } as never);
      mockRegistry.mockResolvedValue({
        managers: [manager('release-desk', 'Release Desk')],
        error: null,
      });
      // Rust can only refuse a shortcut it was sent.
      mockSync.mockImplementation(async (config: { managers: unknown[] }) =>
        config.managers.length > 0
          ? [
              {
                managerKey: 'release-desk',
                shortcut: 'Control+Alt+KeyR',
                reason: 'taken elsewhere',
              },
            ]
          : []
      );
      renderHook(() => useSupervisorMenuBar(vi.fn()));

      await waitFor(() => expect(showToast).toHaveBeenCalled());
      expect(showToast.mock.lastCall?.[0]).toContain('"Release Desk": taken elsewhere');
    });
  });
});
