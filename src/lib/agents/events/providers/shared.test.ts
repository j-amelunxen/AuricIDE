import { describe, expect, it } from 'vitest';
import { extractPath, isCommandShaped, truncateLabel } from './shared';

describe('extractPath', () => {
  it('finds a token that contains a path separator', () => {
    expect(extractPath('src/lib/example.ts')).toBe('src/lib/example.ts');
  });

  it('finds a bare filename by its extension', () => {
    expect(extractPath('README.md')).toBe('README.md');
  });

  it('strips surrounding quotes and trailing punctuation', () => {
    expect(extractPath('"src/lib/example.ts",')).toBe('src/lib/example.ts');
    expect(extractPath('(src/lib/example.ts)')).toBe('src/lib/example.ts');
  });

  it('picks the path out of a longer sentence', () => {
    expect(extractPath('Wrote 12 lines to src/lib/new-feature.ts successfully')).toBe(
      'src/lib/new-feature.ts'
    );
  });

  it('returns undefined for text with nothing path-shaped', () => {
    expect(extractPath('pnpm test:run')).toBeUndefined();
    expect(extractPath('TODO')).toBeUndefined();
  });
});

describe('truncateLabel', () => {
  it('collapses internal whitespace', () => {
    expect(truncateLabel('a   b\n  c')).toBe('a b c');
  });

  it('leaves short text untouched', () => {
    expect(truncateLabel('short note')).toBe('short note');
  });

  it('elides text past the character limit', () => {
    const long = 'x'.repeat(200);
    const result = truncateLabel(long);
    expect(result).toHaveLength(121);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('isCommandShaped', () => {
  it('accepts a flagged command whose first token is executable-like', () => {
    expect(isCommandShaped('pnpm test:run --reporter=verbose -t "epic"')).toBe(true);
  });

  it('accepts a plain two-word command', () => {
    expect(isCommandShaped('git status')).toBe(true);
  });

  it('accepts a script invocation starting with a relative path', () => {
    expect(isCommandShaped('./scripts/build.sh --dmg')).toBe(true);
  });

  it('rejects a prose sentence containing a comma', () => {
    // This is the Claude Code TUI echoing the user's own prompt back — not a
    // command line, even though its first word looks executable-like.
    expect(
      isCommandShaped('Ich habe so regelmäßige Situationen, dass ich in der Anwendung klicke')
    ).toBe(false);
  });

  it('rejects a sentence ending in a period', () => {
    expect(isCommandShaped('Please look at the file.')).toBe(false);
  });

  it('rejects a sentence ending in a question mark', () => {
    expect(isCommandShaped('Is this right?')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isCommandShaped('')).toBe(false);
  });

  it('rejects a first token with characters no executable name would have', () => {
    expect(isCommandShaped('"quoted" arg')).toBe(false);
  });
});
