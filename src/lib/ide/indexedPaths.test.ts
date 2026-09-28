import { describe, expect, it } from 'vitest';
import { indexedPathLookup } from './indexedPaths';

describe('indexedPathLookup', () => {
  const paths = ['/p/src/a.ts', '/p/src/lib/b.ts', '/p/README.md'];

  it('knows every indexed file', () => {
    const knows = indexedPathLookup(paths);
    expect(knows('/p/src/a.ts')).toBe(true);
    expect(knows('/p/README.md')).toBe(true);
    expect(knows('/p/src/new.ts')).toBe(false);
  });

  it('knows every folder that holds an indexed file', () => {
    const knows = indexedPathLookup(paths);
    expect(knows('/p/src')).toBe(true);
    expect(knows('/p/src/lib')).toBe(true);
    expect(knows('/p/empty')).toBe(false);
  });

  it('builds the lookup once per file list', () => {
    expect(indexedPathLookup(paths)).toBe(indexedPathLookup(paths));
    expect(indexedPathLookup([...paths])).not.toBe(indexedPathLookup(paths));
  });
});
