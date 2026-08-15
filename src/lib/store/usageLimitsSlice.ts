import type { StateCreator } from 'zustand';

import type { UsageSnapshot } from '@/lib/usage/types';

export interface UsageLimitsSlice {
  usageSnapshots: UsageSnapshot[];
  /** `idle` until something has been asked for, so the chip can stay away
   *  rather than flashing an empty state on every launch. */
  usageStatus: 'idle' | 'loading' | 'ready' | 'error';
  loadUsageLimits: () => Promise<void>;
  refreshUsageLimits: () => Promise<void>;
}

/**
 * The state only ever holds a list.
 *
 * Whatever comes back over IPC is someone else's promise, and a status-bar chip
 * is the last place that should throw on it — this is the boundary where the
 * shape stops being assumed.
 */
function toSnapshots(value: unknown): UsageSnapshot[] {
  return Array.isArray(value) ? (value as UsageSnapshot[]) : [];
}

export const createUsageLimitsSlice: StateCreator<UsageLimitsSlice> = (set) => ({
  usageSnapshots: [],
  usageStatus: 'idle',

  /** The cheap read: whatever is already stored, no process started. */
  loadUsageLimits: async () => {
    try {
      const { usageLimitsRead } = await import('../tauri/usageLimits');
      set({ usageSnapshots: toSnapshots(await usageLimitsRead()), usageStatus: 'ready' });
    } catch {
      // Browser mode, or a backend that has not come up. An empty list is the
      // honest answer, and the chip renders nothing for it.
      set({ usageSnapshots: [], usageStatus: 'error' });
    }
  },

  /**
   * Asks the backend to bring stale readings up to date.
   *
   * Kept safe to call often on purpose — focus, hover and the background timer
   * all land here, and the TTL plus single-flight on the Rust side decide
   * whether that actually costs anything.
   */
  refreshUsageLimits: async () => {
    set({ usageStatus: 'loading' });
    try {
      const { usageLimitsRefresh } = await import('../tauri/usageLimits');
      set({ usageSnapshots: toSnapshots(await usageLimitsRefresh()), usageStatus: 'ready' });
    } catch {
      set({ usageSnapshots: [], usageStatus: 'error' });
    }
  },
});
