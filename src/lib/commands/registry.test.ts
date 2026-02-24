import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCommandRegistry, Command, defaultCommands } from './registry';

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cmd',
    label: 'Test Command',
    category: 'file',
    action: vi.fn(),
    ...overrides,
  };
}

describe('createCommandRegistry', () => {
  let registry: ReturnType<typeof createCommandRegistry>;

  beforeEach(() => {
    registry = createCommandRegistry();
  });

  it('starts empty', () => {
    expect(registry.getAll()).toEqual([]);
  });

  it('registers a command', () => {
    const cmd = makeCommand({ id: 'file.save', label: 'Save' });
    registry.register(cmd);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0].id).toBe('file.save');
  });

  it('registers multiple commands', () => {
    registry.register(makeCommand({ id: 'file.save', label: 'Save' }));
    registry.register(makeCommand({ id: 'file.open', label: 'Open' }));
    expect(registry.getAll()).toHaveLength(2);
  });

  it('overwrites command with same id', () => {
    registry.register(makeCommand({ id: 'file.save', label: 'Save v1' }));
    registry.register(makeCommand({ id: 'file.save', label: 'Save v2' }));
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0].label).toBe('Save v2');
  });

  it('unregisters a command', () => {
    registry.register(makeCommand({ id: 'file.save', label: 'Save' }));
    registry.unregister('file.save');
    expect(registry.getAll()).toEqual([]);
  });

  it('unregister is a no-op for unknown id', () => {
    registry.register(makeCommand({ id: 'file.save', label: 'Save' }));
    registry.unregister('unknown');
    expect(registry.getAll()).toHaveLength(1);
  });

  it('getAll returns all registered commands', () => {
    registry.register(makeCommand({ id: 'file.save', label: 'Save', category: 'file' }));
    registry.register(makeCommand({ id: 'git.commit', label: 'Commit', category: 'git' }));
    registry.register(
      makeCommand({ id: 'view.sidebar', label: 'Toggle Sidebar', category: 'view' })
    );
    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.id)).toEqual(['file.save', 'git.commit', 'view.sidebar']);
  });
});

describe('search', () => {
  let registry: ReturnType<typeof createCommandRegistry>;

  beforeEach(() => {
    registry = createCommandRegistry();
    registry.register(
      makeCommand({ id: 'file.save', label: 'Save', category: 'file', shortcut: '⌘S' })
    );
    registry.register(makeCommand({ id: 'file.save-as', label: 'Save As', category: 'file' }));
    registry.register(makeCommand({ id: 'file.new', label: 'New File', category: 'file' }));
    registry.register(makeCommand({ id: 'git.commit', label: 'Commit Changes', category: 'git' }));
    registry.register(
      makeCommand({ id: 'view.sidebar', label: 'Toggle Sidebar', category: 'view' })
    );
  });

  it('returns all commands when query is empty', () => {
    expect(registry.search('')).toHaveLength(5);
  });

  it('returns matching commands by label substring', () => {
    const results = registry.search('save');
    expect(results).toHaveLength(2);
    expect(results.map((c) => c.id)).toContain('file.save');
    expect(results.map((c) => c.id)).toContain('file.save-as');
  });

  it('is case-insensitive', () => {
    const results = registry.search('SAVE');
    expect(results).toHaveLength(2);
  });

  it('matches on category', () => {
    const results = registry.search('git');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('git.commit');
  });

  it('ranks prefix matches higher than substring matches', () => {
    const results = registry.search('save');
    expect(results[0].id).toBe('file.save');
    expect(results[1].id).toBe('file.save-as');
  });

  it('returns empty array when nothing matches', () => {
    expect(registry.search('zzzzz')).toEqual([]);
  });

  it('matches partial substrings within label', () => {
    const results = registry.search('side');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('view.sidebar');
  });
});

describe('defaultCommands', () => {
  it('exports a non-empty array of default commands', () => {
    expect(defaultCommands.length).toBeGreaterThan(0);
  });

  it('every default command has id, label, and category', () => {
    for (const cmd of defaultCommands) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(cmd.category).toBeTruthy();
    }
  });

  it('contains expected categories', () => {
    const categories = new Set(defaultCommands.map((c) => c.category));
    expect(categories).toContain('file');
    expect(categories).toContain('git');
    expect(categories).toContain('agent');
    expect(categories).toContain('canvas');
    expect(categories).toContain('view');
    expect(categories).toContain('markdown');
  });

  it('contains file.save with shortcut', () => {
    const save = defaultCommands.find((c) => c.id === 'file.save');
    expect(save).toBeDefined();
    expect(save!.shortcut).toBe('⌘S');
  });

  it('contains markdown.find-references command', () => {
    const findRefs = defaultCommands.find((c) => c.id === 'markdown.find-references');
    expect(findRefs).toBeDefined();
    expect(findRefs!.label).toBe('Find All References');
    expect(findRefs!.category).toBe('markdown');
    expect(findRefs!.shortcut).toBe('Alt+F7');
  });
});
