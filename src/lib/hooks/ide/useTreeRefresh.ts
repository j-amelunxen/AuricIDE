'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { collectLoadedDirs, findNodeByPath, type FileNode } from '@/lib/store/fileTreeSlice';
import { readDirectory, listAllFiles, type FileEntry } from '@/lib/tauri/fs';
import { resolveGitStatusForPath } from '@/lib/git/resolveGitStatus';
import { DISCARD_UNSAVED_PM } from '@/lib/pm/unsavedLeave';
import type { GitFileStatus } from '@/lib/tauri/git';
import type { GitRepoState } from '@/lib/store/gitSlice';
import type { useIDEState } from '../useIDEState';

/** repoPath -> that repo's fileStatuses, built once per refresh rather than once per tree node. */
export function statusesByRepo(
  repoStates: Record<string, GitRepoState>
): Record<string, GitFileStatus[]> {
  const result: Record<string, GitFileStatus[]> = {};
  for (const path in repoStates) result[path] = repoStates[path].fileStatuses;
  return result;
}

export function useTreeRefresh(
  state: ReturnType<typeof useIDEState>,
  confirm: (options: { title: string; message: string; confirmLabel?: string }) => Promise<boolean>
) {
  const confirmLeaveUnsavedPm = useCallback(async (): Promise<boolean> => {
    if (!useStore.getState().pmDirty) return true;
    const go = await confirm(DISCARD_UNSAVED_PM);
    if (!go) return false;
    useStore.getState().discardPmChanges();
    return true;
  }, [confirm]);

  const leaveWorkPlace = useCallback(async (): Promise<boolean> => {
    if (!(await confirmLeaveUnsavedPm())) return false;
    useStore.getState().closeWorkPlace();
    return true;
  }, [confirmLeaveUnsavedPm]);

  const refreshProjectIndexes = useCallback(
    async (rootPath: string, isRootRefresh: boolean): Promise<void> => {
      const store = useStore.getState();
      const gitRefresh = isRootRefresh
        ? store.discoverAndRefreshGit(rootPath)
        : store.refreshGitStatus();
      const [, allFiles] = await Promise.all([
        gitRefresh.catch(() => undefined),
        listAllFiles(rootPath).catch(() => null),
      ]);
      if (allFiles) state.setAllFiles(allFiles);
    },
    [state]
  );

  const handleRefresh = useCallback(
    async (dir?: string, isRoot?: boolean): Promise<FileEntry[] | undefined> => {
      const path = dir || state.rootPath;
      if (!path) return;

      if (!dir || isRoot || dir === state.rootPath) {
        const [entries] = await Promise.all([
          readDirectory(path),
          refreshProjectIndexes(path, true),
        ]);
        const { repos, repoStates } = useStore.getState();
        const statuses = statusesByRepo(repoStates);
        const currentTree = useStore.getState().fileTree ?? [];
        const existingByPath = new Map<string, FileNode>(currentTree.map((n) => [n.path, n]));
        const tree: FileNode[] = entries.map((e) => {
          const existing = existingByPath.get(e.path);
          return {
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            expanded: existing?.expanded ?? false,
            children: existing?.children ?? (e.isDirectory ? [] : undefined),
            gitStatus: resolveGitStatusForPath(e.path, repos, statuses),
            createdAt: e.createdAt,
            newestFileCreatedAt: e.newestFileCreatedAt,
            modifiedAt: e.modifiedAt,
          };
        });
        state.setFileTree(tree);
        return entries;
      } else {
        const entries = await readDirectory(path);
        const { repos, repoStates } = useStore.getState();
        const statuses = statusesByRepo(repoStates);
        const existing = findNodeByPath(useStore.getState().fileTree ?? [], path)?.children ?? [];
        const existingByPath = new Map<string, FileNode>(existing.map((n) => [n.path, n]));
        const children: FileNode[] = entries.map((e) => {
          const prev = existingByPath.get(e.path);
          return {
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            expanded: prev?.expanded ?? false,
            children: prev?.children ?? (e.isDirectory ? [] : undefined),
            gitStatus: resolveGitStatusForPath(e.path, repos, statuses),
            createdAt: e.createdAt,
            newestFileCreatedAt: e.newestFileCreatedAt,
            modifiedAt: e.modifiedAt,
          };
        });
        state.setDirectoryChildren(path, children);
        return entries;
      }
    },
    [state, refreshProjectIndexes]
  );

  const handleRefreshDirs = useCallback(
    async (changedDirs: string[]): Promise<void> => {
      const rootPath = state.rootPath;
      if (!rootPath) return;

      if (changedDirs.includes(rootPath)) {
        await handleRefresh();
        return;
      }

      await refreshProjectIndexes(rootPath, false);

      const loaded = collectLoadedDirs(useStore.getState().fileTree ?? []);
      const targets = changedDirs.filter((dir) => loaded.has(dir));
      if (targets.length === 0) return;
      await Promise.all(targets.map((dir) => handleRefresh(dir).catch(() => undefined)));
    },
    [state, handleRefresh, refreshProjectIndexes]
  );

  const handleCloseProject = useCallback(() => {
    state.closeProject();
    useStore.getState().closeWorkPlace();
    state.setBottomCollapsed(true);
    state.closeAllTabs();
    state.setSelectedPaths([]);
    state.setSelectionAnchor(null);
    state.clearLinkIndex();
    state.clearHeadingIndex();
    state.clearEntityIndex();
    state.resetPmInMemory();
    state.resetBlueprintsInMemory();
    state.resetRequirementsInMemory();
    state.resetExcalidrawInMemory();
    state.setProjectFiles([]);
    state.setEditorContent('');
    state.setImageData(null);
    state.setVideoSrc(null);
    state.setPdfData(null);
    state.setMindmapData(null);
    state.resetGitInMemory();
  }, [state]);

  return {
    confirmLeaveUnsavedPm,
    leaveWorkPlace,
    handleRefresh,
    handleRefreshDirs,
    handleCloseProject,
  };
}
