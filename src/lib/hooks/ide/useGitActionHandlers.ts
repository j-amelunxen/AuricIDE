'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { diffTabId, isDiffTabId } from '@/lib/git/diffTabId';
import { relativeToRepo } from '@/lib/git/repos';
import { selectRepoForPath } from '@/lib/store/gitSlice';
import { buildAgenticCommitTask } from '@/lib/git/agenticCommit';
import type { GitRepoRef } from '@/lib/tauri/git';
import type { useIDEState } from '../useIDEState';

export function repoForGlobalGitAction(store: {
  activeTabId: string | null;
  repos: GitRepoRef[];
  activeRepoPath: string | null;
}): string | null {
  if (store.activeTabId && !isDiffTabId(store.activeTabId)) {
    const repo = selectRepoForPath(store, store.activeTabId);
    if (repo) return repo.path;
  }
  if (store.activeRepoPath) return store.activeRepoPath;
  return store.repos.length === 1 ? store.repos[0].path : null;
}

export function useGitActionHandlers(
  state: ReturnType<typeof useIDEState>,
  handleRefresh: () => Promise<unknown>
) {
  const handleCommit = useCallback(
    async (repoPath: string, options?: { push?: boolean }) => {
      if (state.agentSettings.agenticCommit) {
        const providerId = state.agentSettings.commitProviderId || state.defaultProvider.id;
        const provider =
          state.providers.find((p) => p.id === providerId) ??
          state.providers[0] ??
          state.defaultProvider;
        const branchName = state.repoStates[repoPath]?.branchInfo?.name ?? '';
        const task = buildAgenticCommitTask(
          state.agentSettings.agenticCommitPrompt,
          branchName,
          state.agentSettings.branchTicketPattern,
          { push: options?.push === true }
        );

        await state.spawnNewAgent({
          name: `commit:${repoPath.split('/').pop() ?? 'repo'}`,
          model: provider.defaultModel,
          provider: provider.id,
          task,
          cwd: repoPath,
        });
        state.setCommitMessage(repoPath, '');
        return;
      }

      await state.commit(repoPath);
      handleRefresh();
    },
    [state, handleRefresh]
  );

  const handlePush = useCallback(
    async (repoPath: string) => {
      const { showToast } = useStore.getState();
      try {
        await state.push(repoPath);
        showToast('Pushed to origin', 'success');
      } catch (e) {
        showToast(String(e), 'error');
      }
    },
    [state]
  );

  const handleDiscardFile = useCallback(
    async (repoPath: string, filePath: string) => {
      const { discardChanges } = await import('@/lib/tauri/git');
      await discardChanges(repoPath, filePath);
      handleRefresh();
      const fullPath = `${repoPath}/${filePath}`;
      if (state.activeTabId === fullPath) state.closeTab(fullPath);
    },
    [state, handleRefresh]
  );

  const handleDiffFileClick = useCallback(
    async (repoPath: string, path: string, side: 'staged' | 'unstaged' = 'unstaged') => {
      const { getGitDiff } = await import('@/lib/tauri/git');
      const patch = await getGitDiff(repoPath, path, side);
      const source = { kind: side };
      const id = diffTabId(source, path, repoPath);
      state.setDiffTab(id, { patch, filePath: path, source, repoPath });
      state.openTab({
        id,
        path,
        name: `${path.split('/').pop()} ${side === 'staged' ? '(staged)' : '(diff)'}`,
      });
    },
    [state]
  );

  const editorHistoryPath = useCallback((): string | null => {
    const store = useStore.getState();
    const tabId = store.activeTabId;
    if (tabId && !isDiffTabId(tabId)) {
      const repo = selectRepoForPath(store, tabId);
      if (repo) {
        if (store.activeRepoPath !== repo.path) store.setActiveRepoPath(repo.path);
        return relativeToRepo(tabId, repo.path);
      }
    }
    return store.historyPath;
  }, []);

  const showFileHistory = useCallback(() => {
    const store = useStore.getState();
    store.setScmView('history');
    const path = editorHistoryPath();
    const repoPath = useStore.getState().activeRepoPath;
    if (repoPath && path) void store.loadFileHistory(repoPath, path);
  }, [editorHistoryPath]);

  const handleScmViewChange = useCallback(
    (view: 'changes' | 'history' | 'compare') => {
      const store = useStore.getState();
      store.setScmView(view);
      if (view === 'history') {
        const path = editorHistoryPath();
        const repoPath = useStore.getState().activeRepoPath;
        if (repoPath && path) void store.loadFileHistory(repoPath, path);
      }
      if (view === 'compare' && store.activeRepoPath) {
        void store.loadBranches(store.activeRepoPath);
      }
    },
    [editorHistoryPath]
  );

  const handleActiveRepoChange = useCallback((repoPath: string) => {
    const store = useStore.getState();
    store.setActiveRepoPath(repoPath);
    if (store.scmView === 'compare') {
      void store.loadBranches(repoPath);
    }
    if (store.scmView === 'history') {
      const tabId = store.activeTabId;
      if (tabId && !isDiffTabId(tabId)) {
        const repo = selectRepoForPath(store, tabId);
        if (repo && repo.path === repoPath) {
          void store.loadFileHistory(repoPath, relativeToRepo(tabId, repoPath));
        }
      }
    }
  }, []);

  const handleHistoryCommitClick = useCallback(
    async (oid: string) => {
      const store = useStore.getState();
      const repoPath = store.activeRepoPath;
      const path = store.historyPath;
      if (!repoPath || !path) return;
      const { getGitDiffCommit } = await import('@/lib/tauri/git');
      const patch = await getGitDiffCommit(repoPath, oid, path);
      const summary = store.historyCommits.find((c) => c.oid === oid)?.summary ?? '';
      const source = { kind: 'revision' as const, oid, summary };
      const id = diffTabId(source, path, repoPath);
      state.setDiffTab(id, { patch, filePath: path, source, repoPath });
      state.openTab({
        id,
        path,
        name: `${path.split('/').pop()} @ ${oid.slice(0, 7)}`,
      });
      store.setHistorySelectedOid(oid);
    },
    [state]
  );

  const handleCompareRefChange = useCallback((ref: string) => {
    const store = useStore.getState();
    const repoPath = store.activeRepoPath;
    if (!repoPath) return;
    void store.loadCompare(repoPath, ref);
  }, []);

  const handleCompareFileClick = useCallback(
    async (path: string) => {
      const store = useStore.getState();
      const repoPath = store.activeRepoPath;
      const ref = store.compareRef;
      if (!repoPath || !ref) return;
      const { getGitDiffFileRef } = await import('@/lib/tauri/git');
      const patch = await getGitDiffFileRef(repoPath, ref, path);
      const source = { kind: 'ref' as const, ref };
      const id = diffTabId(source, path, repoPath);
      state.setDiffTab(id, { patch, filePath: path, source, repoPath });
      state.openTab({
        id,
        path,
        name: `${path.split('/').pop()} ↔ ${ref}`,
      });
    },
    [state]
  );

  return {
    handleCommit,
    handlePush,
    handleDiscardFile,
    handleDiffFileClick,
    editorHistoryPath,
    showFileHistory,
    handleScmViewChange,
    handleActiveRepoChange,
    handleHistoryCommitClick,
    handleCompareRefChange,
    handleCompareFileClick,
  };
}
