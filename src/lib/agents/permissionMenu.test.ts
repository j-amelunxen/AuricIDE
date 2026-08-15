import { describe, it, expect } from 'vitest';
import { parsePermissionMenu, promptTailLines } from './permissionMenu';

describe('parsePermissionMenu', () => {
  it('parses a Claude-style numbered menu', () => {
    const tail = [
      'Bash(pnpm test:run src/lib/context/select.test.ts)\n',
      'Do you want to proceed?\n',
      '❯ 1. Yes\n',
      "  2. Yes, and don't ask again for pnpm commands\n",
      '  3. No\n',
    ];
    expect(parsePermissionMenu(tail)).toEqual([
      { send: '1', label: 'Yes' },
      { send: '2', label: "Yes, and don't ask again for pnpm commands" },
      { send: '3', label: 'No' },
    ]);
  });

  it('parses a Codex-style y/n question into two options', () => {
    expect(parsePermissionMenu(['Overwrite existing file? (y/n) '])).toEqual([
      { send: 'y', label: 'Yes' },
      { send: 'n', label: 'No' },
    ]);
  });

  it('recognizes a bracketed y/n question', () => {
    expect(parsePermissionMenu(['Proceed? [Y/n] '])).toEqual([
      { send: 'y', label: 'Yes' },
      { send: 'n', label: 'No' },
    ]);
  });

  it('returns null for ordinary streaming output with no menu', () => {
    expect(
      parsePermissionMenu(['Reading src/lib/agents/fleet.ts\n', 'Editing fleet.test.ts\n'])
    ).toBeNull();
  });

  it('returns null for an empty tail', () => {
    expect(parsePermissionMenu([])).toBeNull();
  });

  it('does not mistake a rhetorical question in prose for a menu', () => {
    expect(parsePermissionMenu(['Hmm, what does splitFleet actually return?\n'])).toBeNull();
  });
});

describe('promptTailLines', () => {
  it('returns the last few meaningful lines, ANSI stripped', () => {
    const tail = [
      '[2mReading fleet.ts[0m\n',
      'Do you want to proceed?\n',
      '❯ 1. Yes\n',
      '  2. No\n',
    ];
    expect(promptTailLines(tail, 3)).toEqual(['Do you want to proceed?', '❯ 1. Yes', '2. No']);
  });

  it('returns an empty array for no output', () => {
    expect(promptTailLines([])).toEqual([]);
  });
});
