import { describe, expect, it } from 'vitest';
import type { FileNode } from '@/lib/store/fileTreeSlice';
import type { FileEntry } from '@/lib/tauri/fs';
import { buildNodes, restampGitStatus, sameEntryPaths } from './treeRefresh';

const entry = (path: string, isDirectory = false, modifiedAt = 1): FileEntry => ({
  name: path.split('/').pop()!,
  path,
  isDirectory,
  modifiedAt,
});

describe('buildNodes', () => {
  it('reuses a node whose entry and badge did not change', () => {
    const resolve = () => undefined;
    const first = buildNodes([entry('/p/a.md'), entry('/p/src', true)], [], resolve);
    expect(first.changed).toBe(true);

    const second = buildNodes([entry('/p/a.md'), entry('/p/src', true)], first.nodes, resolve);
    expect(second.changed).toBe(false);
    expect(second.nodes).toBe(first.nodes);
  });

  it('replaces only the node that changed and keeps its expanded state and children', () => {
    const child: FileNode = { name: 'x.ts', path: '/p/src/x.ts', isDirectory: false };
    const existing: FileNode[] = [
      { name: 'a.md', path: '/p/a.md', isDirectory: false, modifiedAt: 1 },
      {
        name: 'src',
        path: '/p/src',
        isDirectory: true,
        expanded: true,
        children: [child],
        modifiedAt: 1,
      },
    ];
    const { nodes, changed } = buildNodes(
      [entry('/p/a.md', false, 2), entry('/p/src', true)],
      existing,
      (path) => (path === '/p/a.md' ? 'modified' : undefined)
    );
    expect(changed).toBe(true);
    expect(nodes[0]).toMatchObject({ modifiedAt: 2, gitStatus: 'modified' });
    expect(nodes[1]).toBe(existing[1]);
  });
});

describe('restampGitStatus', () => {
  const tree: FileNode[] = [
    {
      name: 'build',
      path: '/p/build',
      isDirectory: true,
      expanded: true,
      children: [{ name: 'out.js', path: '/p/build/out.js', isDirectory: false }],
    },
    { name: 'docs', path: '/p/docs', isDirectory: true, children: [] },
  ];

  it('returns the same tree when no badge changes', () => {
    expect(restampGitStatus(tree, () => undefined)).toBe(tree);
  });

  it('updates badges deep in loaded folders and keeps untouched branches', () => {
    const next = restampGitStatus(tree, (path) =>
      path.startsWith('/p/build') ? 'ignored' : undefined
    );
    expect(next[0].gitStatus).toBe('ignored');
    expect(next[0].children?.[0].gitStatus).toBe('ignored');
    expect(next[1]).toBe(tree[1]);
  });
});

describe('sameEntryPaths', () => {
  it('compares which paths exist, not their metadata', () => {
    const nodes: FileNode[] = [
      { name: 'a', path: '/p/a', isDirectory: false },
      { name: 'b', path: '/p/b', isDirectory: true },
    ];
    expect(sameEntryPaths([entry('/p/b', true, 9), entry('/p/a')], nodes)).toBe(true);
    expect(sameEntryPaths([entry('/p/a')], nodes)).toBe(false);
    expect(sameEntryPaths([entry('/p/a'), entry('/p/c')], nodes)).toBe(false);
  });
});
