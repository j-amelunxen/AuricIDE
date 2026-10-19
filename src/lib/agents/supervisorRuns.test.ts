import { describe, expect, it } from 'vitest';
import { buildRunTree, supervisorRunLabel, type RunTreeFolder } from './supervisorRuns';

const file = (relativePath: string, modifiedAtMs: number | null) => ({
  relativePath,
  path: `/runs/r/${relativePath}`,
  size: 1,
  modifiedAtMs,
});

describe('supervisorRunLabel', () => {
  it('reads the start time out of the folder name', () => {
    expect(supervisorRunLabel('2026-10-16_185017')).toBe('Oct 16, 18:50');
  });

  it('keeps the suffix of a second run in the same second', () => {
    expect(supervisorRunLabel('2026-10-16_185017-2')).toBe('Oct 16, 18:50 #2');
  });

  it('shows a hand-renamed folder as it is', () => {
    expect(supervisorRunLabel('blog review')).toBe('blog review');
  });
});

describe('buildRunTree', () => {
  it('nests by folder and puts what changed last on top at every level', () => {
    const tree = buildRunTree([
      file('notes.md', 100),
      file('frames/a.png', 50),
      file('frames/b.png', 300),
      file('transcript.srt', 200),
    ]);
    expect(tree.map((node) => node.name)).toEqual(['frames', 'transcript.srt', 'notes.md']);
    const frames = tree[0] as RunTreeFolder;
    expect(frames.key).toBe('frames');
    expect(frames.modifiedAtMs).toBe(300);
    expect(frames.children.map((node) => node.name)).toEqual(['b.png', 'a.png']);
  });

  it('gives nested folders keys that stay unique', () => {
    const tree = buildRunTree([file('a/x/one.md', 1), file('b/x/two.md', 2)]);
    const keys = tree.flatMap((node) =>
      node.kind === 'folder' ? node.children.map((child) => (child as RunTreeFolder).key) : []
    );
    expect(keys.sort()).toEqual(['a/x', 'b/x']);
  });

  it('sorts files without a time last, by name', () => {
    const tree = buildRunTree([file('b.md', null), file('a.md', null), file('c.md', 5)]);
    expect(tree.map((node) => node.name)).toEqual(['c.md', 'a.md', 'b.md']);
  });
});
