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
