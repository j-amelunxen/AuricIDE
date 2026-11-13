import { describe, expect, it } from 'vitest';
import { baseName } from './baseName';

describe('baseName', () => {
  it.each([
    ['/repo/src/a.ts', 'a.ts'],
    ['/repo/src/', 'src'],
    ['a.ts', 'a.ts'],
    ['/', ''],
  ])('%s → %s', (path, expected) => {
    expect(baseName(path)).toBe(expected);
  });
});
