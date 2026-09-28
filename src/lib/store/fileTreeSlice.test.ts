import { describe, expect, it } from 'vitest';
import { useStore } from './index';
import { collectLoadedDirs } from './fileTreeSlice';

describe('fileTreeSlice', () => {
  it('starts with empty tree and no selected path', () => {
    const state = useStore.getState();
    expect(state.fileTree).toEqual([]);
    expect(state.selectedPath).toBeNull();
  });

  it('sets file tree', () => {
    const tree = [
      { name: 'src', path: '/src', isDirectory: true, children: [] },
      { name: 'README.md', path: '/README.md', isDirectory: false },
    ];
    useStore.getState().setFileTree(tree);
    expect(useStore.getState().fileTree).toEqual(tree);
  });

  it('selects a file', () => {
    useStore.getState().selectFile('/README.md');
    expect(useStore.getState().selectedPath).toBe('/README.md');
  });

  it('toggles directory expansion', () => {
    const tree = [{ name: 'src', path: '/src', isDirectory: true, expanded: false, children: [] }];
    useStore.getState().setFileTree(tree);
    useStore.getState().toggleExpand('/src');
    expect(useStore.getState().fileTree[0].expanded).toBe(true);

    useStore.getState().toggleExpand('/src');
    expect(useStore.getState().fileTree[0].expanded).toBe(false);
  });

  it('sets root path', () => {
    useStore.getState().setRootPath('/projects/my-app');
    expect(useStore.getState().rootPath).toBe('/projects/my-app');
  });

  it('sets root path to null', () => {
    useStore.getState().setRootPath('/projects/my-app');
    useStore.getState().setRootPath(null);
    expect(useStore.getState().rootPath).toBeNull();
  });

  it('closeProject resets rootPath, fileTree, and selectedPath', () => {
    // Set up state as if a project is open
    useStore.getState().setRootPath('/projects/my-app');
    useStore
      .getState()
      .setFileTree([{ name: 'src', path: '/src', isDirectory: true, children: [] }]);
    useStore.getState().selectFile('/src/index.ts');

    // Close the project
    useStore.getState().closeProject();

    const state = useStore.getState();
    expect(state.rootPath).toBeNull();
    expect(state.fileTree).toEqual([]);
    expect(state.selectedPath).toBeNull();
  });
});

describe('fileTreeSlice — structural sharing', () => {
  // The explorer's rows are memoized by node identity, so an update must hand
  // back every node it did not touch as the same object.
  const tree = () => [
    {
      name: 'a',
      path: '/p/a',
      isDirectory: true,
      expanded: true,
      children: [{ name: 'deep', path: '/p/a/deep', isDirectory: true, children: [] }],
    },
    {
      name: 'b',
      path: '/p/b',
      isDirectory: true,
      expanded: true,
      children: [{ name: 'x.ts', path: '/p/b/x.ts', isDirectory: false }],
    },
  ];

  it('setDirectoryChildren replaces only the path down to the changed folder', () => {
    useStore.getState().setFileTree(tree());
    const [a, b] = useStore.getState().fileTree;

    useStore
      .getState()
      .setDirectoryChildren('/p/a/deep', [
        { name: 'n.ts', path: '/p/a/deep/n.ts', isDirectory: false },
      ]);

    const [nextA, nextB] = useStore.getState().fileTree;
    expect(nextB).toBe(b);
    expect(nextA).not.toBe(a);
    expect(nextA.children?.[0].children?.[0].path).toBe('/p/a/deep/n.ts');
  });

  it('toggleExpand leaves sibling folders untouched', () => {
    useStore.getState().setFileTree(tree());
    const [, b] = useStore.getState().fileTree;

    useStore.getState().toggleExpand('/p/a');

    const [nextA, nextB] = useStore.getState().fileTree;
    expect(nextB).toBe(b);
    expect(nextA.expanded).toBe(false);
  });
});

describe('fileTreeSlice — path separators', () => {
  it('reaches nested folders on Windows paths', () => {
    useStore.getState().setFileTree([
      {
        name: 'a',
        path: 'C:\\p\\a',
        isDirectory: true,
        expanded: true,
        children: [{ name: 'deep', path: 'C:\\p\\a\\deep', isDirectory: true, children: [] }],
      },
    ]);

    useStore.getState().toggleExpand('C:\\p\\a\\deep');
    useStore
      .getState()
      .setDirectoryChildren('C:\\p\\a\\deep', [
        { name: 'n.ts', path: 'C:\\p\\a\\deep\\n.ts', isDirectory: false },
      ]);

    const deep = useStore.getState().fileTree[0].children?.[0];
    expect(deep?.expanded).toBe(true);
    expect(deep?.children?.[0].path).toBe('C:\\p\\a\\deep\\n.ts');
  });

  it('reaches children of a root folder that is itself the separator', () => {
    useStore.getState().setFileTree([
      {
        name: '/',
        path: '/',
        isDirectory: true,
        expanded: true,
        children: [{ name: 'a', path: '/a', isDirectory: true, children: [] }],
      },
    ]);

    useStore.getState().toggleExpand('/a');

    expect(useStore.getState().fileTree[0].children?.[0].expanded).toBe(true);
  });

  it('does not treat a sibling sharing a name prefix as an ancestor', () => {
    useStore.getState().setFileTree([
      { name: 'ab', path: '/p/ab', isDirectory: true, children: [] },
      {
        name: 'a',
        path: '/p/a',
        isDirectory: true,
        children: [{ name: 'b', path: '/p/a/b', isDirectory: true, children: [] }],
      },
    ]);
    const [ab] = useStore.getState().fileTree;

    useStore.getState().toggleExpand('/p/a/b');

    expect(useStore.getState().fileTree[0]).toBe(ab);
    expect(useStore.getState().fileTree[1].children?.[0].expanded).toBe(true);
  });
});

describe('collectLoadedDirs', () => {
  it('lists every directory whose children are already loaded', () => {
    const dirs = collectLoadedDirs([
      {
        name: 'src',
        path: '/p/src',
        isDirectory: true,
        children: [
          { name: 'lib', path: '/p/src/lib', isDirectory: true, children: [] },
          { name: 'index.ts', path: '/p/src/index.ts', isDirectory: false },
        ],
      },
      { name: 'README.md', path: '/p/README.md', isDirectory: false },
    ]);
    expect([...dirs].sort()).toEqual(['/p/src', '/p/src/lib']);
  });

  it('leaves out directories that were never opened', () => {
    // A directory with no `children` array has not been read yet — refreshing
    // it would load a subtree nobody is looking at.
    const dirs = collectLoadedDirs([
      { name: 'src', path: '/p/src', isDirectory: true },
      { name: 'docs', path: '/p/docs', isDirectory: true, children: [] },
    ]);
    expect([...dirs]).toEqual(['/p/docs']);
  });
});
