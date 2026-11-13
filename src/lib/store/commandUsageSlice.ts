import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import { APP_CONFIG_KEYS, readAppJson, writeAppJson } from '@/lib/config/appConfig';

/** Deep enough to cover a working session's muscle memory, shallow enough to stay legible. */
export const MAX_RECENT_COMMANDS = 12;

/**
 * Most-recently-used command ids, newest first. Drives the command palette's
 * default ordering so the commands a user actually reaches for stop sinking
 * beneath the ones that merely registered earlier.
 */
export interface CommandUsageSlice {
  recentCommandIds: string[];
  recordCommandUse: (id: string) => void;
  loadRecentCommands: () => void;
}

function persist(ids: string[]) {
  writeAppJson(APP_CONFIG_KEYS.recentCommands, ids);
}

export const createCommandUsageSlice: StateCreator<StoreState, [], [], CommandUsageSlice> = (
  set,
  get
) => ({
  recentCommandIds: [],

  recordCommandUse: (id) => {
    if (typeof id !== 'string' || id === '') return;
    const updated = [id, ...get().recentCommandIds.filter((c) => c !== id)].slice(
      0,
      MAX_RECENT_COMMANDS
    );
    set({ recentCommandIds: updated });
    persist(updated);
  },

  loadRecentCommands: () => {
    const parsed = readAppJson(APP_CONFIG_KEYS.recentCommands);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return;
    set({ recentCommandIds: parsed.slice(0, MAX_RECENT_COMMANDS) });
  },
});
