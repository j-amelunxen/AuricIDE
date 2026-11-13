import { describe, expect, it } from 'vitest';
import { defaultCommands } from './registry';

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

  it('offers New Scratch File with its global shortcut', () => {
    const cmd = defaultCommands.find((c) => c.id === 'file.new-scratch');
    expect(cmd).toBeDefined();
    expect(cmd?.label).toBe('New Scratch File');
    expect(cmd?.category).toBe('file');
    expect(cmd?.shortcut).toBe('⌘N');
  });

  it('offers Open Inbox, mirroring Open Notifications, reachable with no project open', () => {
    const cmd = defaultCommands.find((c) => c.id === 'view.inbox');
    expect(cmd).toBeDefined();
    expect(cmd?.label).toBe('Open Inbox');
    expect(cmd?.category).toBe('view');
    expect(cmd?.requiresProject).toBeFalsy();
  });

  it('offers Capture to Inbox with its global shortcut, reachable with no project open', () => {
    const cmd = defaultCommands.find((c) => c.id === 'inbox.capture');
    expect(cmd).toBeDefined();
    expect(cmd?.label).toBe('Capture to Inbox');
    expect(cmd?.category).toBe('view');
    expect(cmd?.shortcut).toBe('⌘⇧I');
    expect(cmd?.requiresProject).toBeFalsy();
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

  it('labels agent.deploy as Start Agent without renaming the id', () => {
    const cmd = defaultCommands.find((c) => c.id === 'agent.deploy');
    expect(cmd).toBeDefined();
    expect(cmd!.id).toBe('agent.deploy');
    expect(cmd!.label).toBe('Start Agent');
  });
});

// The same JSON file is embedded by the Rust side to build the native menu
// (src-tauri/src/menu.rs). These guard the properties that side depends on;
// the Rust tests guard the rest. Break one and the menu starts lying.
describe('the command manifest as the menu contract', () => {
  it('gives every command a unique id', () => {
    const ids = defaultCommands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every Category > Label path unique', () => {
    // axbridge addresses a menu item by its text path. Two identical labels in
    // one submenu would make `menu "View > Open Goals"` ambiguous, and the CLI
    // resolves menu paths by text with no way to disambiguate.
    const paths = defaultCommands.map((c) => `${c.category} > ${c.label}`);
    const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(duplicates).toEqual([]);
  });

  it('gives every command a non-empty label', () => {
    expect(defaultCommands.filter((c) => !c.label.trim()).map((c) => c.id)).toEqual([]);
  });

  it('only uses categories the menu builder knows', () => {
    const known = new Set(['file', 'git', 'agent', 'canvas', 'view', 'markdown', 'help']);
    expect(defaultCommands.filter((c) => !known.has(c.category)).map((c) => c.id)).toEqual([]);
  });

  it('names the project-gated commands explicitly', () => {
    // Greying out a command that actually works is its own kind of lie, so
    // this list is evidence-based: each of these returns early without a
    // rootPath. Adding one means proving the guard exists.
    const gated = defaultCommands.filter((c) => c.requiresProject).map((c) => c.id);
    expect(gated.sort()).toEqual([
      'excalidraw.new',
      'excalidraw.sync-all',
      'file.find-in-files',
      'file.import-video',
      'file.new',
      'git.commit',
      'git.compare-with-branch',
      'git.file-history',
      'git.next-hunk',
      'git.prev-hunk',
      'git.stage-all',
      'git.toggle-blame',
      'git.unstage-all',
      'view.toggle-terminal',
    ]);
  });
});
