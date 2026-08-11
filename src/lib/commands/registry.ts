import { rankCommands } from './fuzzy';
import manifest from './commands.json';

export type CommandCategory = 'file' | 'git' | 'agent' | 'canvas' | 'view' | 'markdown';

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  /** The action needs an open project; the native menu greys it out otherwise. */
  requiresProject?: boolean;
  action: () => void;
}

export function createCommandRegistry(): {
  register: (cmd: Command) => void;
  unregister: (id: string) => void;
  search: (query: string) => Command[];
  getAll: () => Command[];
} {
  const commands = new Map<string, Command>();

  return {
    register(cmd: Command): void {
      commands.set(cmd.id, cmd);
    },

    unregister(id: string): void {
      commands.delete(id);
    },

    search(query: string): Command[] {
      return rankCommands(Array.from(commands.values()), query).map((r) => r.command);
    },

    getAll(): Command[] {
      return Array.from(commands.values());
    },
  };
}

export const defaultCommands: Omit<Command, 'action'>[] = manifest.commands.map((c) => ({
  id: c.id,
  label: c.label,
  category: c.category as CommandCategory,
  ...('shortcut' in c && c.shortcut ? { shortcut: c.shortcut } : {}),
  ...('requiresProject' in c && c.requiresProject ? { requiresProject: true as const } : {}),
}));
