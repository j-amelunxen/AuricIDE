import { describe, expect, it } from 'vitest';
import {
  baseName,
  isNoopDrop,
  joinPath,
  numberedName,
  planTransfers,
  replaceBlocker,
} from './transferPlan';

describe('planTransfers', () => {
  it('sends each item into the folder under its own name', () => {
    expect(planTransfers(['/p/a.md', '/p/src/b.ts'], '/p/docs')).toEqual({
      transfers: [
        { source: '/p/a.md', destination: '/p/docs/a.md' },
        { source: '/p/src/b.ts', destination: '/p/docs/b.ts' },
      ],
      skipped: [],
    });
  });

  it('refuses a folder dropped onto itself or into its own subtree', () => {
    expect(planTransfers(['/p/src'], '/p/src').skipped).toEqual([
      { source: '/p/src', reason: 'into-itself' },
    ]);
    expect(planTransfers(['/p/src'], '/p/src/lib/deep').skipped).toEqual([
      { source: '/p/src', reason: 'into-itself' },
    ]);
  });

  it('does not treat a name-prefix sibling as the subtree', () => {
    expect(planTransfers(['/p/src'], '/p/src-old').transfers).toEqual([
      { source: '/p/src', destination: '/p/src-old/src' },
    ]);
  });

  it('leaves an item that already lives in the folder where it is', () => {
    expect(planTransfers(['/p/docs/a.md'], '/p/docs')).toEqual({
      transfers: [],
      skipped: [{ source: '/p/docs/a.md', reason: 'same-folder' }],
    });
  });

  it('moves a folder once, not again for its selected children', () => {
    expect(planTransfers(['/p/src/a.ts', '/p/src', '/p/b.md'], '/p/docs').transfers).toEqual([
      { source: '/p/src', destination: '/p/docs/src' },
      { source: '/p/b.md', destination: '/p/docs/b.md' },
    ]);
  });

  it('plans the valid items of a mixed drop and reports the rest', () => {
    const plan = planTransfers(['/p/docs', '/p/a.md'], '/p/docs/inner');
    expect(plan.transfers).toEqual([{ source: '/p/a.md', destination: '/p/docs/inner/a.md' }]);
    expect(plan.skipped).toEqual([{ source: '/p/docs', reason: 'into-itself' }]);
  });

  it('handles a filesystem root as the destination', () => {
    expect(planTransfers(['/p/a.md'], '/').transfers).toEqual([
      { source: '/p/a.md', destination: '/a.md' },
    ]);
  });

  it('ignores empty payloads', () => {
    expect(planTransfers([''], '/p/docs')).toEqual({ transfers: [], skipped: [] });
  });
});

describe('isNoopDrop', () => {
  it('is true only when nothing would move', () => {
    expect(isNoopDrop(['/p/docs/a.md'], '/p/docs')).toBe(true);
    expect(isNoopDrop(['/p/src'], '/p/src/lib')).toBe(true);
    expect(isNoopDrop(['/p/docs/a.md', '/p/b.md'], '/p/docs')).toBe(false);
  });
});

describe('replaceBlocker', () => {
  it('allows replacing an unrelated item', () => {
    expect(replaceBlocker(['/p/src/a.md'], '/p/docs/a.md')).toBeNull();
  });

  it('refuses replacing a folder that holds the item being moved', () => {
    // Moving /p/x/x into /p: the existing /p/x is the source's own parent.
    expect(replaceBlocker(['/p/x/x'], '/p/x')).toMatch(/contains an item being moved/);
  });

  it('refuses when another item of the same drop lives inside the destination', () => {
    expect(replaceBlocker(['/p/b/x', '/p/a/x/y.md'], '/p/a/x')).not.toBeNull();
  });

  it('compares without case, as the default macOS volume does', () => {
    expect(replaceBlocker(['/p/a/X/x'], '/p/a/x')).not.toBeNull();
  });
});

describe('path helpers', () => {
  it('reads the last segment and joins without doubling slashes', () => {
    expect(baseName('/p/docs/a.md')).toBe('a.md');
    expect(baseName('/p/docs/')).toBe('docs');
    expect(joinPath('/p/docs', 'a.md')).toBe('/p/docs/a.md');
    expect(joinPath('/', 'a.md')).toBe('/a.md');
  });
});

describe('numberedName', () => {
  it('numbers before the extension, like Finder', () => {
    expect(numberedName('notes.md', 2)).toBe('notes 2.md');
    expect(numberedName('archive.tar.gz', 3)).toBe('archive.tar 3.gz');
  });

  it('numbers names without an extension and dotfiles at the end', () => {
    expect(numberedName('docs', 2)).toBe('docs 2');
    expect(numberedName('.env', 2)).toBe('.env 2');
  });
});
