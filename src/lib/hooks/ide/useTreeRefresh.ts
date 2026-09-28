'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { collectLoadedDirs, findNodeByPath } from '@/lib/store/fileTreeSlice';
import { readDirectory, listAllFiles, type FileEntry } from '@/lib/tauri/fs';
import { resolveGitStatusForPath } from '@/lib/git/resolveGitStatus';
import { buildNodes, restampGitStatus, sameEntryPaths } from '@/lib/explorer/treeRefresh';
import { createCoalescingRunner } from '@/lib/ide/coalescingRunner';
import type { TreeChangeSummary } from '@/lib/ide/fsEventRouter';
import { perfBreadcrumbs } from '@/lib/perf/freezeProbe';
import { DISCARD_UNSAVED_PM } from '@/lib/pm/unsavedLeave';
import type { GitFileStatus } from '@/lib/tauri/git';
import type { GitRepoState } from '@/lib/store/gitSlice';
import type { IDEState } from './liveIDEState';

/** repoPath -> that repo's fileStatuses, built once per refresh rather than once per tree node. */
export function statusesByRepo(
  repoStates: Record<string, GitRepoState>
): Record<string, GitFileStatus[]> {
  const result: Record<string, GitFileStatus[]> = {};
  for (const path in repoStates) result[path] = repoStates[path].fileStatuses;
  return result;
}

interface IndexScope {
  discoverRepos: boolean;
  listFiles: boolean;
}

const FULL: IndexScope = { discoverRepos: true, listFiles: true };
/** Callers that cannot say what changed get the expensive, always-correct answer. */
const STRUCTURAL: TreeChangeSummary = { structural: true, ignoreRulesChanged: false };

interface TreeChange {
  dirs: string[];
  summary: TreeChangeSummary;
}

export function mergeTreeChanges(a: TreeChange, b: TreeChange): TreeChange {
  return {
    dirs: [...new Set([...a.dirs, ...b.dirs])],
    summary: {
      structural: a.summary.structural || b.summary.structural,
      ignoreRulesChanged: a.summary.ignoreRulesChanged || b.summary.ignoreRulesChanged,
    },
  };
}

function gitStatusCounts(repoStates: Record<string, GitRepoState>): Record<string, number> {
  let statuses = 0;
  for (const path in repoStates) statuses += repoStates[path].fileStatuses.length;
  return { repos: Object.keys(repoStates).length, statuses };
}

export function useTreeRefresh(
  state: IDEState,
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
    async (rootPath: string, scope: IndexScope): Promise<void> => {
      const store = useStore.getState();
      const gitRefresh = perfBreadcrumbs.span(
        scope.discoverRepos ? 'git-discover-refresh' : 'git-status-refresh',
        () =>
          scope.discoverRepos ? store.discoverAndRefreshGit(rootPath) : store.refreshGitStatus(),
        () => gitStatusCounts(useStore.getState().repoStates)
      );
      // The project-wide file list only changes when paths appear or vanish;
      // walking it again for a content write is the most expensive no-op here.
      const fileList = scope.listFiles
        ? perfBreadcrumbs
            .span(
              'list-all-files',
              () => listAllFiles(rootPath),
              (files) => ({ paths: files.length })
            )
            .catch(() => null)
        : Promise.resolve(null);
      const [, allFiles] = await Promise.all([gitRefresh.catch(() => undefined), fileList]);
      if (allFiles) {
        await perfBreadcrumbs.span('set-all-files', async () => state.setAllFiles(allFiles));
      }
    },
    [state]
  );

  const badgeResolver = () => {
    const { repos, repoStates } = useStore.getState();
    const statuses = statusesByRepo(repoStates);
    return (path: string) => resolveGitStatusForPath(path, repos, statuses);
  };

  const applyRootEntries = (entries: FileEntry[]) => {
    const current = useStore.getState().fileTree ?? [];
    const { nodes, changed } = buildNodes(entries, current, badgeResolver());
    if (changed) state.setFileTree(nodes);
  };

  const handleRefresh = useCallback(
    async (dir?: string, isRoot?: boolean): Promise<FileEntry[] | undefined> => {
      const path = dir || state.rootPath;
      if (!path) return;

      if (!dir || isRoot || dir === state.rootPath) {
        const [entries] = await Promise.all([
          readDirectory(path),
          refreshProjectIndexes(path, FULL),
        ]);
        applyRootEntries(entries);
        return entries;
      } else {
        const entries = await readDirectory(path);
        const existing = findNodeByPath(useStore.getState().fileTree ?? [], path)?.children ?? [];
        const { nodes, changed } = buildNodes(entries, existing, badgeResolver());
        if (changed) state.setDirectoryChildren(path, nodes);
        return entries;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read the store, not render scope
    [state, refreshProjectIndexes]
  );

  const refreshChangedDirs = async ({ dirs, summary }: TreeChange): Promise<void> => {
    const rootPath = state.rootPath;
    if (!rootPath) return;

    const touchesRoot = dirs.includes(rootPath);
    perfBreadcrumbs.add('fs-flush', { dirs: dirs.length, root: touchesRoot, ...summary });

    if (touchesRoot) {
      await perfBreadcrumbs.span('root-refresh', async () => {
        const entries = await readDirectory(rootPath);
        // Repos are rediscovered only when the root's own entries changed —
        // saving `.gitignore` in place does not add or remove a repository.
        const rootChanged = !sameEntryPaths(entries, useStore.getState().fileTree ?? []);
        await refreshProjectIndexes(rootPath, {
          discoverRepos: summary.structural && rootChanged,
          listFiles: summary.structural,
        });
        applyRootEntries(entries);
      });
    } else {
      await refreshProjectIndexes(rootPath, {
        discoverRepos: false,
        listFiles: summary.structural,
      });
    }

    const loaded = collectLoadedDirs(useStore.getState().fileTree ?? []);
    const targets = dirs.filter((dir) => dir !== rootPath && loaded.has(dir));
    await Promise.all(targets.map((dir) => handleRefresh(dir).catch(() => undefined)));

    if (summary.ignoreRulesChanged) {
      const tree = useStore.getState().fileTree ?? [];
      const restamped = restampGitStatus(tree, badgeResolver());
      if (restamped !== tree) state.setFileTree(restamped);
    }
  };

  // One refresh at a time; events arriving meanwhile become one follow-up.
  const refreshChangedDirsRef = useRef(refreshChangedDirs);
  useEffect(() => {
    refreshChangedDirsRef.current = refreshChangedDirs;
  });
  const refreshRunnerRef = useRef<ReturnType<typeof createCoalescingRunner<TreeChange>> | null>(
    null
  );

  const handleRefreshDirs = useCallback(
    (changedDirs: string[], summary: TreeChangeSummary = STRUCTURAL): Promise<void> => {
      refreshRunnerRef.current ??= createCoalescingRunner<TreeChange>(
        (change) => refreshChangedDirsRef.current(change),
        mergeTreeChanges
      );
      return refreshRunnerRef.current.submit({ dirs: changedDirs, summary });
    },
    []
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
