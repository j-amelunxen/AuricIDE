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
