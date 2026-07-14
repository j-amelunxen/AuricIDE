'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { getProjectFilesInfo } from '@/lib/tauri/fs';
import { listProviders } from '@/lib/tauri/providers';
import { createFsEventRouter, type FsEventRouter } from '@/lib/ide/fsEventRouter';
import { useFileWatcher } from '@/lib/hooks/useFileWatcher';
import { useAgentEvents } from '@/lib/hooks/useAgentEvents';
import { useActiveTabContentLoader } from '@/lib/hooks/useActiveTabContentLoader';
import { useCloseTabShortcut } from '@/lib/hooks/useCloseTabShortcut';
import { type useIDEState } from './useIDEState';
import { type useIDEHandlers } from './useIDEHandlers';

export function useIDEActions(
  state: ReturnType<typeof useIDEState>,
  handlers: ReturnType<typeof useIDEHandlers>
) {
  const lastShiftTime = useRef<number>(0);
  const fsRouterRef = useRef<FsEventRouter | null>(null);
  const handleRefreshRef = useRef(handlers.handleRefresh);

  // The viewer content always follows the active tab (tab click, tab close, …)
  useActiveTabContentLoader(state.activeTabId, handlers.loadTabContent);

  // Cmd/Ctrl+W closes the active tab, not the window
  useCloseTabShortcut();

  // On mount: load recent projects and custom slash commands from localStorage
  useEffect(() => {
    state.loadRecentProjects();
    state.loadStarredProjects();
    state.loadCustomSlashCommands();
    state.loadBlueprintServerUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: check CLI connection status
  useEffect(() => {
    import('@/lib/tauri/agents').then((m) => {
      m.checkCliStatus().then(state.setCliConnected);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: load provider info for default model resolution
  useEffect(() => {
    listProviders()
      .then((fetched) => {
        if (fetched.length > 0) {
          state.setProviders(fetched);
          state.setDefaultProvider(fetched[0]);
        }
      })
      .catch(() => {
        // Browser mode — keep fallback
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The router callbacks must always see the latest handleRefresh without
  // recreating the router (a recreate would drop pending debounce timers).
  useEffect(() => {
    handleRefreshRef.current = handlers.handleRefresh;
  }, [handlers.handleRefresh]);

  // File watcher — events split into two debounce lanes: regular file changes
  // refresh the tree; project DB writes (MCP server, external agents) reload
  // the PM/requirements/goals data behind Mission Control's counts.
  if (!fsRouterRef.current) {
    fsRouterRef.current = createFsEventRouter({
      onTreeChange: () => void handleRefreshRef.current(),
      onProjectDataChange: () => {
        const s = useStore.getState();
        const root = s.rootPath;
        if (!root) return;
        void s.refreshPmData(root);
        void s.loadRequirements(root);
        void s.loadGoals(root);
      },
    });
  }

  // Cancel pending refreshes on unmount and on rootPath change (prevents stale refresh from prior project)
  useEffect(() => {
    return () => fsRouterRef.current?.dispose();
  }, [state.rootPath]);

  useFileWatcher(
    state.rootPath,
    useCallback((event) => fsRouterRef.current?.handle(event), [])
  );

  // Agent event subscriptions
  const { appendAgentLog, updateAgentStatus } = state;
  useAgentEvents(
    useCallback(
      (event) => {
        appendAgentLog(event.agentId, event.line);
      },
      [appendAgentLog]
    ),
    useCallback((event) => updateAgentStatus(event.agentId, event.status), [updateAgentStatus])
  );

  useEffect(() => {
    if (!state.rootPath) return;
    let canceled = false;
    const path = state.rootPath;

    // Check if direct LLM is configured
    import('@/lib/tauri/db').then((m) => {
      m.dbGet(path, 'llm_settings', 'api_key').then((k) => {
        if (canceled) return;
        state.setLlmConfigured(!!k);
      });
    });

    import('@/lib/tauri/fs').then((m) => {
      m.listAllFiles(path).then(async (files) => {
        if (canceled) return;
        state.setProjectFiles(files);
        state.setAllFiles(files);

        const mdFiles = files.filter((f) => /\.(md|markdown)$/i.test(f));
        const results = await Promise.allSettled(mdFiles.map((f) => m.readFile(f)));
        if (canceled) return;
        const entries = results
          .map((r, i) => ({ filePath: mdFiles[i], result: r }))
          .filter(
            (x): x is { filePath: string; result: PromiseFulfilledResult<string> } =>
              x.result.status === 'fulfilled'
          )
          .map(({ filePath, result }) => ({ filePath, content: result.value }));
        state.bulkUpdateFilesInIndex(entries);
      });
    });

    state.initProjectDb(path);
    state.loadPmData(path);

    return () => {
      canceled = true;
      state.closeProjectDb(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rootPath]);

  useEffect(() => {
    if (state.fileSelectorOpen && state.rootPath) {
      getProjectFilesInfo(state.rootPath).then(state.setProjectFilesInfo);
    }
  }, [state.fileSelectorOpen, state.rootPath, state.setProjectFilesInfo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        const now = Date.now();
        if (now - lastShiftTime.current < 300) state.setFileSearchOpen(true);
        lastShiftTime.current = now;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        state.setCommandPaletteOpen(!state.commandPaletteOpen);
      } else if (mod && e.key === 'p') {
        e.preventDefault();
        state.setFileSearchOpen(true);
      } else if (mod && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        state.setFileSelectorOpen(true);
      } else if (mod && e.key === 'b') {
        e.preventDefault();
        state.setBottomCollapsed(!state.bottomCollapsed);
      } else if (mod && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        state.setActiveActivity('explorer');
      } else if (mod && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        state.setActiveActivity('source-control');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state]);
}
