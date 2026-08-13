import { describe, expect, it, vi } from 'vitest';
import { fuzzyMatch, rankCommands } from './fuzzy';
import type { Command } from './registry';

function cmd(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cmd',
    label: 'Test Command',
    category: 'file',
    action: vi.fn(),
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('returns a zero-score match for an empty query', () => {
    expect(fuzzyMatch('Save', '')).toEqual({ score: 0, indices: [] });
  });

  it('matches a plain prefix', () => {
    const result = fuzzyMatch('Save', 'sa');
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0, 1]);
  });

  it('matches a subsequence with gaps', () => {
    const result = fuzzyMatch('Commit Changes', 'cmt');
    expect(result).not.toBeNull();
    expect(result!.indices).toHaveLength(3);
  });

  it('matches acronyms across word boundaries', () => {
    const result = fuzzyMatch('Open Goals Extra', 'oge');
    expect(result).not.toBeNull();
    expect(result!.indices).toEqual([0, 5, 11]);
  });

  it('returns null when a character is missing', () => {
    expect(fuzzyMatch('Save', 'sz')).toBeNull();
  });

  it('returns null when the query is longer than the text', () => {
    expect(fuzzyMatch('Save', 'saveee')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('Save', 'SAVE')).not.toBeNull();
  });

  it('scores a prefix match higher than a late substring match', () => {
    const prefix = fuzzyMatch('Save File', 'sa')!;
    const late = fuzzyMatch('Toggle Sassy', 'sa')!;
    expect(prefix.score).toBeGreaterThan(late.score);
  });

  it('scores a consecutive run higher than the same characters scattered mid-word', () => {
    // Both start mid-word, so only the run of consecutive characters separates them.
    const consecutive = fuzzyMatch('xabc yz', 'abc')!;
    const scattered = fuzzyMatch('xaxbxc yz', 'abc')!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it('scores an acronym across word starts higher than a mid-word run', () => {
    const acronym = fuzzyMatch('Stage All Changes', 'sac')!;
    const midWord = fuzzyMatch('Mosaic Renderer', 'sac')!;
    expect(acronym.score).toBeGreaterThan(midWord.score);
  });

  it('scores word-boundary matches higher than mid-word matches', () => {
    const boundary = fuzzyMatch('New File', 'nf')!;
    const midWord = fuzzyMatch('Unfold', 'nf')!;
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it('reports indices in ascending order', () => {
    const result = fuzzyMatch('Start Agent', 'sa')!;
    expect(result.indices).toEqual([...result.indices].sort((a, b) => a - b));
  });

  it('reports indices that actually spell the query', () => {
    const text = 'Fit Canvas to Screen';
    const result = fuzzyMatch(text, 'fcs')!;
    expect(result.indices.map((i) => text[i].toLowerCase()).join('')).toBe('fcs');
  });
});

describe('rankCommands', () => {
  const commands = [
    cmd({ id: 'file.save', label: 'Save', category: 'file' }),
    cmd({ id: 'file.save-as', label: 'Save As', category: 'file' }),
    cmd({ id: 'git.commit', label: 'Commit Changes', category: 'git' }),
    cmd({ id: 'view.goals', label: 'Open Goals', category: 'view' }),
    cmd({ id: 'agent.deploy', label: 'Start Agent', category: 'agent' }),
  ];

  it('returns every command in original order for an empty query', () => {
    const ranked = rankCommands(commands, '');
    expect(ranked.map((r) => r.command.id)).toEqual(commands.map((c) => c.id));
  });

  it('drops commands that do not match', () => {
    const ranked = rankCommands(commands, 'zzzz');
    expect(ranked).toEqual([]);
  });

  it('finds a command by acronym', () => {
    const ranked = rankCommands(commands, 'ogo');
    expect(ranked[0].command.id).toBe('view.goals');
  });

  it('finds a command by scattered characters', () => {
    const ranked = rankCommands(commands, 'cmt');
    expect(ranked[0].command.id).toBe('git.commit');
  });

  it('ranks an exact prefix above a longer label', () => {
    const ranked = rankCommands(commands, 'save');
    expect(ranked[0].command.id).toBe('file.save');
    expect(ranked[1].command.id).toBe('file.save-as');
  });

  it('matches on category when the label does not match', () => {
    const ranked = rankCommands(commands, 'git');
    expect(ranked.map((r) => r.command.id)).toEqual(['git.commit']);
  });

  it('exposes match indices for label highlighting', () => {
    const ranked = rankCommands(commands, 'save');
    expect(ranked[0].indices).toEqual([0, 1, 2, 3]);
  });

  it('exposes no indices when only the category matched', () => {
    const ranked = rankCommands(commands, 'git');
    expect(ranked[0].indices).toEqual([]);
  });

  it('lists recently used commands first for an empty query', () => {
    const ranked = rankCommands(commands, '', ['agent.deploy', 'git.commit']);
    expect(ranked.slice(0, 2).map((r) => r.command.id)).toEqual(['agent.deploy', 'git.commit']);
  });

  it('keeps unused commands in original order behind the recent ones', () => {
    const ranked = rankCommands(commands, '', ['agent.deploy']);
    expect(ranked.map((r) => r.command.id)).toEqual([
      'agent.deploy',
      'file.save',
      'file.save-as',
      'git.commit',
      'view.goals',
    ]);
  });

  it('ignores recent ids that are no longer registered', () => {
    const ranked = rankCommands(commands, '', ['gone.command']);
    expect(ranked.map((r) => r.command.id)).toEqual(commands.map((c) => c.id));
  });

  it('breaks a scoring tie in favour of the recently used command', () => {
    const tied = [
      cmd({ id: 'a.run', label: 'Run Task', category: 'file' }),
      cmd({ id: 'b.run', label: 'Run Task', category: 'file' }),
    ];
    const ranked = rankCommands(tied, 'run', ['b.run']);
    expect(ranked[0].command.id).toBe('b.run');
  });

  it('does not let recency outrank a clearly better match', () => {
    const ranked = rankCommands(commands, 'save', ['git.commit', 'agent.deploy']);
    expect(ranked[0].command.id).toBe('file.save');
  });
});
