import { describe, expect, it } from 'vitest';
import {
  dragItems,
  effectiveSelection,
  isSameOrInside,
  rangeBetween,
  rangeSelection,
  remapPath,
  toggleSelection,
  topLevelPaths,
} from './treeSelection';

const VISIBLE = ['/p/a', '/p/a/one.ts', '/p/a/two.ts', '/p/b.md', '/p/c.md', '/p/d.md'];

describe('effectiveSelection', () => {
  it('uses the explicit list when there is one', () => {
    expect(effectiveSelection(['/p/b.md', '/p/c.md'], '/p/c.md')).toEqual(['/p/b.md', '/p/c.md']);
  });

  it('falls back to the primary row, or nothing', () => {
    expect(effectiveSelection([], '/p/b.md')).toEqual(['/p/b.md']);
    expect(effectiveSelection([], null)).toEqual([]);
  });
});

describe('toggleSelection (Cmd/Ctrl+click)', () => {
  it('adds an unselected row after the ones already selected, and makes it primary', () => {
    expect(toggleSelection(['/p/b.md'], '/p/b.md', '/p/d.md')).toEqual({
      paths: ['/p/b.md', '/p/d.md'],
      primary: '/p/d.md',
      anchor: '/p/d.md',
    });
  });

  it('starts from the single primary row when no list is set yet', () => {
    expect(toggleSelection([], '/p/b.md', '/p/c.md').paths).toEqual(['/p/b.md', '/p/c.md']);
  });

  it('removes a selected row and keeps the primary when it is still selected', () => {
    expect(toggleSelection(['/p/b.md', '/p/c.md', '/p/d.md'], '/p/b.md', '/p/c.md')).toEqual({
      paths: ['/p/b.md', '/p/d.md'],
      primary: '/p/b.md',
      anchor: '/p/c.md',
    });
  });

  it('moves the primary to a row that is still selected when the primary is toggled off', () => {
    const next = toggleSelection(['/p/b.md', '/p/c.md'], '/p/c.md', '/p/c.md');
    expect(next.paths).toEqual(['/p/b.md']);
    expect(next.primary).toBe('/p/b.md');
  });

  it('keeps the last selected row when it is toggled', () => {
    expect(toggleSelection(['/p/b.md'], '/p/b.md', '/p/b.md')).toEqual({
      paths: ['/p/b.md'],
      primary: '/p/b.md',
      anchor: '/p/b.md',
    });
  });
});

describe('rangeBetween', () => {
  it('covers anchor to target in on-screen order, both included, either direction', () => {
    expect(rangeBetween(VISIBLE, '/p/a/two.ts', '/p/c.md')).toEqual([
      '/p/a/two.ts',
      '/p/b.md',
      '/p/c.md',
    ]);
    expect(rangeBetween(VISIBLE, '/p/c.md', '/p/a/two.ts')).toEqual([
      '/p/a/two.ts',
      '/p/b.md',
      '/p/c.md',
    ]);
  });

  it('is the target alone without a visible anchor', () => {
    expect(rangeBetween(VISIBLE, null, '/p/c.md')).toEqual(['/p/c.md']);
    expect(rangeBetween(VISIBLE, '/p/hidden/x.ts', '/p/c.md')).toEqual(['/p/c.md']);
  });
});

describe('rangeSelection (Shift+click)', () => {
  it('replaces the selection with the range and keeps the anchor', () => {
    expect(
      rangeSelection({
        visible: VISIBLE,
        paths: ['/p/a/one.ts', '/p/d.md'],
        primary: '/p/d.md',
        anchor: '/p/b.md',
        target: '/p/d.md',
        additive: false,
      })
    ).toEqual({ paths: ['/p/b.md', '/p/c.md', '/p/d.md'], primary: '/p/d.md', anchor: '/p/b.md' });
  });

  it('re-draws from the same anchor on a second Shift+click', () => {
    const first = rangeSelection({
      visible: VISIBLE,
      paths: ['/p/b.md'],
      primary: '/p/b.md',
      anchor: '/p/b.md',
      target: '/p/d.md',
      additive: false,
    });
    const second = rangeSelection({
      visible: VISIBLE,
      ...first,
      target: '/p/a/two.ts',
      additive: false,
    });
    expect(second.paths).toEqual(['/p/a/two.ts', '/p/b.md']);
    expect(second.anchor).toBe('/p/b.md');
  });

  it('falls back to the primary row as anchor', () => {
    expect(
      rangeSelection({
        visible: VISIBLE,
        paths: [],
        primary: '/p/b.md',
        anchor: null,
        target: '/p/c.md',
        additive: false,
      }).paths
    ).toEqual(['/p/b.md', '/p/c.md']);
  });

  it('adds the range to the existing selection with Cmd/Ctrl+Shift, without duplicates', () => {
    expect(
      rangeSelection({
        visible: VISIBLE,
        paths: ['/p/a/one.ts', '/p/c.md'],
        primary: '/p/c.md',
        anchor: '/p/c.md',
        target: '/p/d.md',
        additive: true,
      }).paths
    ).toEqual(['/p/a/one.ts', '/p/c.md', '/p/d.md']);
  });
});

describe('topLevelPaths', () => {
  it('drops paths that travel with a selected ancestor folder, and duplicates', () => {
    expect(topLevelPaths(['/p/a/one.ts', '/p/a', '/p/b.md', '/p/b.md'])).toEqual([
      '/p/a',
      '/p/b.md',
    ]);
  });

  it('keeps siblings whose names share a prefix', () => {
    expect(topLevelPaths(['/p/a', '/p/ab.md'])).toEqual(['/p/a', '/p/ab.md']);
  });
});

describe('dragItems', () => {
  it('drags the whole selection when the grabbed row is part of it', () => {
    expect(dragItems(['/p/b.md', '/p/c.md'], '/p/c.md', '/p/b.md')).toEqual(['/p/b.md', '/p/c.md']);
  });

  it('drags only the grabbed row when it is not selected', () => {
    expect(dragItems(['/p/b.md', '/p/c.md'], '/p/c.md', '/p/d.md')).toEqual(['/p/d.md']);
  });

  it('drags the single primary row when no list is set', () => {
    expect(dragItems([], '/p/d.md', '/p/d.md')).toEqual(['/p/d.md']);
  });
});

describe('isSameOrInside / remapPath', () => {
  it('matches the path itself and its subtree, not name-prefix siblings', () => {
    expect(isSameOrInside('/p/a', '/p/a')).toBe(true);
    expect(isSameOrInside('/p/a/one.ts', '/p/a')).toBe(true);
    expect(isSameOrInside('/p/ab.md', '/p/a')).toBe(false);
  });

  it('re-points a moved path and its subtree only', () => {
    expect(remapPath('/p/a', '/p/a', '/p/x/a')).toBe('/p/x/a');
    expect(remapPath('/p/a/one.ts', '/p/a', '/p/x/a')).toBe('/p/x/a/one.ts');
    expect(remapPath('/p/ab.md', '/p/a', '/p/x/a')).toBe('/p/ab.md');
  });
});
