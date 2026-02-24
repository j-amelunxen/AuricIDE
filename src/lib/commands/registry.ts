export interface Command {
  id: string;
  label: string;
  category: 'file' | 'git' | 'agent' | 'canvas' | 'view' | 'markdown';
  shortcut?: string;
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
      const all = Array.from(commands.values());
      if (query === '') return all;

      const lowerQuery = query.toLowerCase();

      const prefixMatches: Command[] = [];
      const substringMatches: Command[] = [];

      for (const cmd of all) {
        const lowerLabel = cmd.label.toLowerCase();
        const lowerCategory = cmd.category.toLowerCase();

        if (lowerLabel.startsWith(lowerQuery) || lowerCategory.startsWith(lowerQuery)) {
          prefixMatches.push(cmd);
        } else if (lowerLabel.includes(lowerQuery) || lowerCategory.includes(lowerQuery)) {
          substringMatches.push(cmd);
        }
      }

      return [...prefixMatches, ...substringMatches];
    },

    getAll(): Command[] {
      return Array.from(commands.values());
    },
  };
}

export const defaultCommands: Omit<Command, 'action'>[] = [
  { id: 'file.new', label: 'New File', category: 'file' },
  { id: 'file.open-folder', label: 'Open Folder', category: 'file' },
  {
    id: 'file.search',
    label: 'Search Files Everywhere',
    category: 'file',
    shortcut: 'Shift Shift',
  },
  {
    id: 'file.advanced-selection',
    label: 'Advanced File Selection (Filter/Copy)',
    category: 'file',
    shortcut: '⌘⌥F',
  },
  { id: 'file.save', label: 'Save', category: 'file', shortcut: '⌘S' },
  { id: 'git.commit', label: 'Commit Changes', category: 'git' },
  { id: 'git.stage-all', label: 'Stage All Changes', category: 'git' },
  { id: 'git.show-changes', label: 'Show Changes', category: 'git' },
  { id: 'agent.deploy', label: 'Deploy New Agent', category: 'agent' },
  { id: 'agent.ascii-art', label: 'Generate ASCII Art', category: 'agent' },
  { id: 'agent.kill-all', label: 'Kill All Agents', category: 'agent' },
  { id: 'canvas.toggle', label: 'Toggle Canvas View', category: 'canvas' },
  { id: 'canvas.fit', label: 'Fit Canvas to Screen', category: 'canvas' },
  { id: 'view.toggle-sidebar', label: 'Toggle Left Sidebar', category: 'view', shortcut: '⌘B' },
  { id: 'view.toggle-terminal', label: 'Toggle Terminal', category: 'view', shortcut: '⌘J' },
  { id: 'view.focus-explorer', label: 'Focus Explorer', category: 'view', shortcut: '⌘⇧E' },
  {
    id: 'view.focus-source-control',
    label: 'Focus Source Control',
    category: 'view',
    shortcut: '⌘⇧G',
  },
  { id: 'view.link-graph', label: 'Show Link Graph', category: 'view' },
  {
    id: 'markdown.rename-heading',
    label: 'Rename Heading',
    category: 'markdown',
    shortcut: 'F2',
  },
  {
    id: 'markdown.find-references',
    label: 'Find All References',
    category: 'markdown',
    shortcut: 'Alt+F7',
  },
  {
    id: 'markdown.extract-section',
    label: 'Extract Section to File',
    category: 'markdown',
  },
  { id: 'file.import-spec', label: 'Import Project Spec', category: 'file' },
];
