'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getProjectFilesInfo } from '@/lib/tauri/fs';
import { listProviders } from '@/lib/tauri/providers';
import { useFileWatcher } from '@/lib/hooks/useFileWatcher';
import { useAgentEvents } from '@/lib/hooks/useAgentEvents';
import { type useIDEState } from './useIDEState';
import { type useIDEHandlers } from './useIDEHandlers';

export function useIDEActions(
  state: ReturnType<typeof useIDEState>,
  handlers: ReturnType<typeof useIDEHandlers>
) {
  const lastShiftTime = useRef<number>(0);
  const debouncedRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // On mount: load recent projects and custom slash commands from localStorage
  useEffect(() => {
    state.loadRecentProjects();
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

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(debouncedRefresh.current);
  }, []);

  // File watcher — debounced refresh on filesystem changes
  const { handleRefresh } = handlers;
  useFileWatcher(
    state.rootPath,
    useCallback(() => {
      clearTimeout(debouncedRefresh.current);
      debouncedRefresh.current = setTimeout(() => handleRefresh(), 300);
    }, [handleRefresh])
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
    useCallback(
      (event) => updateAgentStatus(event.agentId, event.status),
      [updateAgentStatus]
    )
  );

  useEffect(() => {
    if (state.rootPath) {
      // Check if direct LLM is configured
      import('@/lib/tauri/db').then((m) => {
        m.dbGet(state.rootPath!, 'llm_settings', 'api_key').then((k) => {
          state.setLlmConfigured(!!k);
        });
      });

      import('@/lib/tauri/fs').then((m) => {
        m.listAllFiles(state.rootPath!).then(async (files) => {
          state.setProjectFiles(files);
          state.setAllFiles(files);

          const mdFiles = files.filter((f) => /\.(md|markdown)$/i.test(f));
          const results = await Promise.allSettled(mdFiles.map((f) => m.readFile(f)));
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

      state.initProjectDb(state.rootPath);
      state.loadPmData(state.rootPath);
    }
    return () => {
      if (state.rootPath) state.closeProjectDb(state.rootPath);
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
