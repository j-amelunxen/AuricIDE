import { describe, expect, it } from 'vitest';
import {
  firstStop,
  focusStops,
  hunkCountOf,
  nextFileStop,
  stepStop,
  stopAfterAction,
  stopAfterViewed,
} from './reviewFocus';

const p = (n: number) =>
  Array.from({ length: n }, (_, i) => `@@ -${i},1 +${i},1 @@\n-a\n+b`).join('\n');
const files = [
  { path: 'a.ts', patch: p(2), collapsed: false, viewed: false },
  { path: 'b.ts', patch: p(1), collapsed: true, viewed: true },
  { path: 'c.ts', patch: p(1), collapsed: false, viewed: false },
  { path: 'd.ts', patch: '', collapsed: false, viewed: false },
];

describe('reviewFocus', () => {
  it('counts hunks', () => {
    expect(hunkCountOf(p(3))).toBe(3);
    expect(hunkCountOf('')).toBe(0);
  });

  it('lists every hunk of an open file, and only the header of a folded or empty one', () => {
    expect(focusStops(files)).toEqual([
      { path: 'a.ts', hunk: 0 },
      { path: 'a.ts', hunk: 1 },
      { path: 'b.ts', hunk: null },
      { path: 'c.ts', hunk: 0 },
      { path: 'd.ts', hunk: null },
    ]);
  });

  it('lands on the header of the first unviewed file, or the first file', () => {
    expect(firstStop([files[1], files[2]])).toEqual({ path: 'c.ts', hunk: null });
    expect(firstStop([files[1]])).toEqual({ path: 'b.ts', hunk: null });
    expect(firstStop([])).toBeNull();
  });

  it('steps through the stops and stays at the ends', () => {
    const stops = focusStops(files);
    expect(stepStop(stops, { path: 'a.ts', hunk: 1 }, 1)).toEqual({ path: 'b.ts', hunk: null });
    expect(stepStop(stops, { path: 'a.ts', hunk: 0 }, -1)).toEqual({ path: 'a.ts', hunk: 0 });
    // A file header that is not itself a stop starts at that file.
    expect(stepStop(stops, { path: 'a.ts', hunk: null }, 1)).toEqual({ path: 'a.ts', hunk: 0 });
    expect(stepStop(stops, null, 1)).toEqual({ path: 'a.ts', hunk: 0 });
  });

  it('jumps file by file', () => {
    expect(nextFileStop(files, { path: 'a.ts', hunk: 1 }, 1)).toEqual({ path: 'b.ts', hunk: null });
    expect(nextFileStop(files, { path: 'a.ts', hunk: 1 }, -1)).toEqual({
      path: 'a.ts',
      hunk: null,
    });
  });

  it('after accepting goes to the next hunk; after discarding the next one moved up', () => {
    const stops = focusStops(files);
    expect(stopAfterAction(stops, { path: 'a.ts', hunk: 0 }, 'accept')).toEqual({
      path: 'a.ts',
      hunk: 1,
    });
    expect(stopAfterAction(stops, { path: 'a.ts', hunk: 0 }, 'discard')).toEqual({
      path: 'a.ts',
      hunk: 0,
    });
    expect(stopAfterAction(stops, { path: 'a.ts', hunk: 1 }, 'discard')).toEqual({
      path: 'b.ts',
      hunk: null,
    });
    expect(stopAfterAction(stops, { path: 'c.ts', hunk: 0 }, 'accept')).toEqual({
      path: 'd.ts',
      hunk: null,
    });
    expect(stopAfterAction([{ path: 'x', hunk: 0 }], { path: 'x', hunk: 0 }, 'accept')).toBeNull();
  });

  it('after marking viewed goes to the next unviewed file header', () => {
    expect(stopAfterViewed(files, 'a.ts')).toEqual({ path: 'c.ts', hunk: null });
    expect(stopAfterViewed(files, 'd.ts')).toBeNull();
  });
});
