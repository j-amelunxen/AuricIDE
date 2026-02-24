import type { StateCreator } from 'zustand';
import type { SlashCommand } from '@/lib/editor/slashCommandSource';

const STORAGE_KEY = 'auric-custom-slash-commands';

export interface SlashCommandSlice {
  customSlashCommands: SlashCommand[];
  addCustomSlashCommand: (cmd: SlashCommand) => void;
  removeCustomSlashCommand: (trigger: string) => void;
  loadCustomSlashCommands: () => void;
}

function persist(commands: SlashCommand[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export const createSlashCommandSlice: StateCreator<SlashCommandSlice> = (set, get) => ({
  customSlashCommands: [],

  addCustomSlashCommand: (cmd) => {
    const filtered = get().customSlashCommands.filter((c) => c.trigger !== cmd.trigger);
    const updated = [...filtered, cmd];
    set({ customSlashCommands: updated });
    persist(updated);
  },

  removeCustomSlashCommand: (trigger) => {
    const updated = get().customSlashCommands.filter((c) => c.trigger !== trigger);
    set({ customSlashCommands: updated });
    persist(updated);
  },

  loadCustomSlashCommands: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SlashCommand[];
        if (Array.isArray(parsed)) {
          set({ customSlashCommands: parsed });
        }
      }
    } catch {
      // corrupted data — keep empty
    }
  },
});
