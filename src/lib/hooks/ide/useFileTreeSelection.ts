'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { type FileNode } from '@/lib/store/fileTreeSlice';
import { readDirectory } from '@/lib/tauri/fs';
import { resolveGitStatusForPath } from '@/lib/git/resolveGitStatus';
import { statusesByRepo } from './useTreeRefresh';
import type { useIDEState } from '../useIDEState';

export function useFileTreeSelection(
  state: ReturnType<typeof useIDEState>,
  leaveWorkPlace: () => Promise<boolean>
) {
  const handleFileSelect = useCallback(
    async (path: string) => {
      if (useStore.getState().pmDirty) {
        if (!(await leaveWorkPlace())) return;
      } else {
        useStore.getState().closeWorkPlace();
      }
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
      state.openTab({ id: path, path, name: path.split('/').pop() ?? path });
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
      const current =
        state.selectedPaths.length > 0
          ? state.selectedPaths
          : state.selectedPath
            ? [state.selectedPath]
            : [];
      const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      state.setSelectedPaths(next);
      state.selectFile(path);
      state.setSelectionAnchor(path);
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

  const handleToggleDir = useCallback(
    async (path: string) => {
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
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

  return {
    handleFileSelect,
    handleFocusNode,
    handleToggleSelect,
    handleRangeSelect,
    handleClearSelection,
    handleToggleDir,
  };
}
