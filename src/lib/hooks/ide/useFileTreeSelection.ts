'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { openFileTab } from './openFileTab';
import { type FileNode } from '@/lib/store/fileTreeSlice';
import { readDirectory } from '@/lib/tauri/fs';
import { resolveGitStatusForPath } from '@/lib/git/resolveGitStatus';
import { statusesByRepo } from './useTreeRefresh';
import { toggleSelection } from '@/lib/explorer/treeSelection';
import { findNode } from '@/app/components/explorer/fileTreeTypes';
import type { IDEState } from './liveIDEState';

export function useFileTreeSelection(state: IDEState, leaveWorkPlace: () => Promise<boolean>) {
  const handleFileSelect = useCallback(
    async (path: string) => {
      if (useStore.getState().pmDirty && !(await leaveWorkPlace())) return;
      openFileTab(path, {
        closeWorkPlace: useStore.getState().closeWorkPlace,
        selectFile: state.selectFile,
        openTab: state.openTab,
      });
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
    },
    [state, leaveWorkPlace]
  );

  const handleFocusNode = useCallback(
    (path: string) => {
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
    },
    [state]
  );

  const handleToggleSelect = useCallback(
    (path: string) => {
      const next = toggleSelection(state.selectedPaths, state.selectedPath, path);
      state.setSelectedPaths(next.paths);
      if (next.primary !== null) state.selectFile(next.primary);
      state.setSelectionAnchor(next.anchor);
    },
    [state]
  );

  const handleRangeSelect = useCallback(
    (paths: string[], newPrimary: string) => {
      state.setSelectedPaths(paths);
      state.selectFile(newPrimary);
    },
    [state]
  );

  const handleClearSelection = useCallback(() => {
    state.setSelectedPaths(state.selectedPath ? [state.selectedPath] : []);
  }, [state]);

  /** Loads a folder's children and flips it open or closed; the selection is the caller's. */
  const toggleDirOpen = useCallback(
    async (path: string) => {
      state.toggleExpand(path);
      const entries = await readDirectory(path);
      const { repos, repoStates } = useStore.getState();
      const statuses = statusesByRepo(repoStates);
      const children: FileNode[] = entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        expanded: false,
        children: e.isDirectory ? [] : undefined,
        gitStatus: resolveGitStatusForPath(e.path, repos, statuses),
        createdAt: e.createdAt,
        newestFileCreatedAt: e.newestFileCreatedAt,
        modifiedAt: e.modifiedAt,
      }));
      state.setDirectoryChildren(path, children);
    },
    [state]
  );

  const handleToggleDir = useCallback(
    async (path: string) => {
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
      await toggleDirOpen(path);
    },
    [state, toggleDirOpen]
  );

  /** Hovering a collapsed folder mid-drag opens it; the dragged selection stays as it is. */
  const handleExpandDir = useCallback(
    async (path: string) => {
      const node = findNode(useStore.getState().fileTree ?? [], path);
      if (!node?.isDirectory || node.expanded) return;
      await toggleDirOpen(path);
    },
    [toggleDirOpen]
  );

  return {
    handleFileSelect,
    handleFocusNode,
    handleToggleSelect,
    handleRangeSelect,
    handleClearSelection,
    handleToggleDir,
    handleExpandDir,
  };
}
