import manifest from './commands.json';

import type { Command, CommandCategory } from './types';
export type { Command, CommandCategory };

export const defaultCommands: Omit<Command, 'action'>[] = manifest.commands.map((c) => ({
  id: c.id,
  label: c.label,
  category: c.category as CommandCategory,
  ...('shortcut' in c && c.shortcut ? { shortcut: c.shortcut } : {}),
  ...('requiresProject' in c && c.requiresProject ? { requiresProject: true as const } : {}),
}));
