import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import { APP_CONFIG_KEYS, readAppJson, writeAppJson } from '@/lib/config/appConfig';
import type { SlashCommand } from '@/lib/editor/slashCommandSource';

export interface SlashCommandSlice {
  customSlashCommands: SlashCommand[];
  addCustomSlashCommand: (cmd: SlashCommand) => void;
  removeCustomSlashCommand: (trigger: string) => void;
  loadCustomSlashCommands: () => void;
}

function persist(commands: SlashCommand[]) {
  writeAppJson(APP_CONFIG_KEYS.customSlashCommands, commands);
}

export const createSlashCommandSlice: StateCreator<StoreState, [], [], SlashCommandSlice> = (
  set,
  get
) => ({
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
    const parsed = readAppJson(APP_CONFIG_KEYS.customSlashCommands);
    if (Array.isArray(parsed)) set({ customSlashCommands: parsed as SlashCommand[] });
  },
});
