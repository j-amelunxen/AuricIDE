import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';

import type { UsageSnapshot } from '@/lib/usage/types';

const mockRead = vi.fn();
const mockRefresh = vi.fn();

vi.mock('../tauri/usageLimits', () => ({
  usageLimitsRead: () => mockRead(),
  usageLimitsRefresh: () => mockRefresh(),
}));

import { createUsageLimitsSlice, type UsageLimitsSlice } from './usageLimitsSlice';

function makeSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    provider: 'codex',
    planLabel: 'plus',
    windows: [
      {
        limitId: 'codex',
        limitLabel: null,
        kind: '7d',
        label: '7 d',
        usedPercent: 40,
        resetsAt: 1_787_301_067,
        windowMinutes: 10080,
      },
    ],
    credits: null,
    observedAt: 1_787_300_000,
    source: 'app-server',
    ...overrides,
  };
}

function createTestStore() {
  return createStore<UsageLimitsSlice>()((...a) => ({ ...createUsageLimitsSlice(...a) }));
}

describe('usageLimitsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const store = createTestStore();
    expect(store.getState().usageSnapshots).toEqual([]);
    expect(store.getState().usageHistory).toEqual([]);
    expect(store.getState().usageStatus).toBe('idle');
  });

  it('loads whatever is already stored', async () => {
    mockRead.mockResolvedValueOnce({ snapshots: [makeSnapshot()], history: [] });
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageSnapshots).toHaveLength(1);
    expect(store.getState().usageStatus).toBe('ready');
  });

  it('loads the trail alongside the last reading', async () => {
    const earlier = {
      provider: 'codex',
      observedAt: 1_787_200_000,
      windows: [
        {
          limitId: 'codex',
          kind: '7d' as const,
          usedPercent: 20,
          resetsAt: 1_787_301_067,
          windowMinutes: 10080,
        },
      ],
    };
    mockRead.mockResolvedValueOnce({
      snapshots: [makeSnapshot()],
      history: [earlier],
    });
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageHistory).toEqual([earlier]);
  });

  it('still accepts a bare list from an older backend', async () => {
    // Before the trail existed the command answered an array. Treating that
    // as "no history" is honest; treating it as a crash is not.
    mockRead.mockResolvedValueOnce([makeSnapshot()]);
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageSnapshots).toHaveLength(1);
    expect(store.getState().usageHistory).toEqual([]);
  });

  it('refreshes through the backend', async () => {
    mockRefresh.mockResolvedValueOnce({
      snapshots: [makeSnapshot({ provider: 'claude' })],
      history: [],
    });
    const store = createTestStore();

    await store.getState().refreshUsageLimits();

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(store.getState().usageSnapshots[0].provider).toBe('claude');
    expect(store.getState().usageStatus).toBe('ready');
  });

  it('reports nothing rather than throwing when there is no backend', async () => {
    // Browser mode is a normal state for this app, and a status-bar chip must
    // never be the reason a render blows up.
    mockRead.mockRejectedValueOnce(new Error('Tauri IPC is unavailable'));
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageSnapshots).toEqual([]);
    expect(store.getState().usageHistory).toEqual([]);
    expect(store.getState().usageStatus).toBe('error');
  });

  it('drops stale readings when a refresh fails', async () => {
    // Keeping the previous numbers would let the chip claim a figure the
    // backend has just told us it can no longer stand behind.
    mockRead.mockResolvedValueOnce({ snapshots: [makeSnapshot()], history: [] });
    mockRefresh.mockRejectedValueOnce(new Error('gone'));
    const store = createTestStore();

    await store.getState().loadUsageLimits();
    expect(store.getState().usageSnapshots).toHaveLength(1);

    await store.getState().refreshUsageLimits();
    expect(store.getState().usageSnapshots).toEqual([]);
    expect(store.getState().usageHistory).toEqual([]);
  });

  it('never puts a non-list into the state', async () => {
    // An IPC layer that answers null — a stubbed backend, an older build — must
    // not reach the chip as something it will try to map over.
    mockRead.mockResolvedValueOnce(null);
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageSnapshots).toEqual([]);
  });

  it('returns an empty list when the feature is switched off', async () => {
    // The backend answers an empty array rather than an error when the setting
    // is off, so the chip simply has nothing to show.
    mockRead.mockResolvedValueOnce([]);
    const store = createTestStore();

    await store.getState().loadUsageLimits();

    expect(store.getState().usageSnapshots).toEqual([]);
    expect(store.getState().usageStatus).toBe('ready');
  });
});
