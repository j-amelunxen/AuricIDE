import type { StateCreator } from 'zustand';

import type { UsageLimitsView } from '../tauri/usageLimits';
import type { UsageSample, UsageSnapshot } from '@/lib/usage/types';

export interface UsageLimitsSlice {
  usageSnapshots: UsageSnapshot[];
  /** Earlier readings of the same windows, oldest first. Empty until a
   *  second sample has been kept — a forecast needs a trail. */
  usageHistory: UsageSample[];
  /** `idle` until something has been asked for, so the chip can stay away
   *  rather than flashing an empty state on every launch. */
  usageStatus: 'idle' | 'loading' | 'ready' | 'error';
  loadUsageLimits: () => Promise<void>;
  refreshUsageLimits: () => Promise<void>;
}

/**
 * Whatever comes back over IPC is someone else's promise, and a status-bar chip
 * is the last place that should throw on it — this is the boundary where the
 * shape stops being assumed.
 *
 * An older backend still answers a bare list of snapshots; that is readings
 * without a trail, not a crash.
 */
function toView(value: unknown): UsageLimitsView {
  if (Array.isArray(value)) {
    return { snapshots: value as UsageSnapshot[], history: [] };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      snapshots: Array.isArray(record.snapshots) ? (record.snapshots as UsageSnapshot[]) : [],
      history: Array.isArray(record.history) ? (record.history as UsageSample[]) : [],
    };
  }
  return { snapshots: [], history: [] };
}

export const createUsageLimitsSlice: StateCreator<UsageLimitsSlice> = (set) => ({
  usageSnapshots: [],
  usageHistory: [],
  usageStatus: 'idle',

  /** The cheap read: whatever is already stored, no process started. */
  loadUsageLimits: async () => {
    try {
      const { usageLimitsRead } = await import('../tauri/usageLimits');
      const view = toView(await usageLimitsRead());
      set({
        usageSnapshots: view.snapshots,
        usageHistory: view.history,
        usageStatus: 'ready',
      });
    } catch {
      // Browser mode, or a backend that has not come up. An empty list is the
      // honest answer, and the chip renders nothing for it.
      set({ usageSnapshots: [], usageHistory: [], usageStatus: 'error' });
    }
  },

  /**
   * Asks the backend to spend a Codex check and re-read Claude's drop file.
   *
   * Hover and focus must not land here — that process costs credits. The
   * 15-minute poller lives in Rust and writes the store itself; this path
   * is the refresh button.
   */
  refreshUsageLimits: async () => {
    set({ usageStatus: 'loading' });
    try {
      const { usageLimitsRefresh } = await import('../tauri/usageLimits');
      const view = toView(await usageLimitsRefresh());
      set({
        usageSnapshots: view.snapshots,
        usageHistory: view.history,
        usageStatus: 'ready',
      });
    } catch {
      set({ usageSnapshots: [], usageHistory: [], usageStatus: 'error' });
    }
  },
});
