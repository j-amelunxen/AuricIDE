import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { writeMenuBarPrefs } from '@/lib/quickAccess/supervisorMenuBar';
import { saveAuricSkills } from '@/lib/settings/auricSkills';
import { useStore } from '@/lib/store';
import { useSupervisorMenuBar } from './useSupervisorMenuBar';

const mockSync = vi.fn();
vi.mock('@/lib/tauri/menuBar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/menuBar')>()),
  menuBarSync: (...args: unknown[]) => mockSync(...args),
}));

let launchListener: ((event: { payload: { skillId?: string } }) => void) | null = null;
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
});
