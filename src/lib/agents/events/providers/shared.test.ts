import { describe, expect, it } from 'vitest';
import { extractPath, truncateLabel } from './shared';

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
