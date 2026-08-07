import type { StateCreator } from 'zustand';

const STORAGE_KEY = 'auric-recent-commands';

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage full or unavailable — recency is a convenience, never a blocker
  }
}

export const createCommandUsageSlice: StateCreator<CommandUsageSlice> = (set, get) => ({
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return;
      set({ recentCommandIds: parsed.slice(0, MAX_RECENT_COMMANDS) });
    } catch {
      // corrupted data — keep empty
    }
  },
});
