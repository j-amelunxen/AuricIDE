import { describe, expect, it } from 'vitest';
import { useStore } from './index';

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
