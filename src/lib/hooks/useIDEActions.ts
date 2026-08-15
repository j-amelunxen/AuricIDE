'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { getProjectFilesInfo } from '@/lib/tauri/fs';
import { listProviders } from '@/lib/tauri/providers';
import { filterProviders } from '@/lib/config/providerPolicy';
import { loadProviderPolicy } from '@/lib/config/projectConfig';
import { createFsEventRouter, type FsEventRouter } from '@/lib/ide/fsEventRouter';
import { nextAttentionAgentId, withReviewFlags } from '@/lib/agents/attention';
import { useFileWatcher } from '@/lib/hooks/useFileWatcher';
import { useAgentEvents } from '@/lib/hooks/useAgentEvents';
import { useAgentConsoleAutoOpen } from '@/lib/hooks/useAgentConsoleAutoOpen';
import { useActiveTabContentLoader } from '@/lib/hooks/useActiveTabContentLoader';
import { useActiveDiffLoader } from '@/lib/hooks/useActiveDiffLoader';
import { useCloseTabShortcut } from '@/lib/hooks/useCloseTabShortcut';
import { useMenuCommands } from '@/lib/hooks/useMenuCommands';
import { useNotificationInbox } from '@/lib/hooks/useNotificationInbox';
import { useTitleBarGutter } from '@/lib/hooks/useTitleBarGutter';
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
  useActiveDiffLoader();

  // Cmd/Ctrl+W closes the active tab, not the window
  useCloseTabShortcut();

  // The native menu runs commands through the same dispatch as the palette
  useMenuCommands(handlers.handleCommandExecute, state.rootPath);

  // The inbox spans projects, so it is not keyed on rootPath like the rest here
  useNotificationInbox();

  // Opens the Agent Console once, in place of the start screen, if the user
  // has asked for that and an agent is already running with no project open.
  useAgentConsoleAutoOpen();

  // The header doubles as the window's title bar on macOS — this keeps the room
  // it leaves for the traffic lights honest when they come and go (fullscreen)
  useTitleBarGutter();

  // On mount: load recent projects and custom slash commands from localStorage
  useEffect(() => {
    state.loadRecentProjects();
    state.loadStarredProjects();
    state.loadRecentCommands();
    state.loadCustomSlashCommands();
    // Before the interrupted agents load below: that pass reconciles the
    // restored chains against the agents that actually came back.
    state.loadSkillCombos();
    state.loadBlueprintServerUrl();
    // Resolve the global scratch dir up front so scratch tabs can be
    // identified (icon, panel) before the panel is first opened.
    void useStore.getState().initScratches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: check CLI connection status
  useEffect(() => {
    import('@/lib/tauri/agents').then((m) => {
      m.checkCliStatus()
        .then(state.setCliConnected)
        .catch(() => {
          state.setCliConnected(false);
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: restore agents that were running when the app last quit
  // (shown as "interrupted" in the agents panel, resumable per click)
  useEffect(() => {
    void useStore.getState().loadInterruptedAgents();
  }, []);

  // A project's own agent settings — its commit prompt, its ticket pattern —
  // replace the previous project's as soon as it is opened. Credentials it
  // still keeps from before the application/project split move up first, so
  // the settings screens show them where they now live.
  useEffect(() => {
    void (async () => {
      const { migrateProjectCredentials } = await import('@/lib/config/migrateCredentials');
      const { lifted } = await migrateProjectCredentials(state.rootPath ?? '');
      if (lifted.length > 0) {
        useStore
          .getState()
          .showToast(
            `Moved ${lifted.length} credential group${lifted.length === 1 ? '' : 's'} from this project to Settings → Application → Credentials`,
            'info'
          );
      }
      await useStore.getState().loadProjectAgentSettings(state.rootPath);
    })();
  }, [state.rootPath]);

  // Provider info for default model resolution, narrowed by the open project's
  // policy so anything reading the store's provider list offers only what this
  // project permits. Re-runs on a project switch, because the next project's
  // policy may permit a different set.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fetched = await listProviders().catch(() => []);
      if (fetched.length === 0) return;
      const policy = await loadProviderPolicy(state.rootPath ?? '');
      const permitted = filterProviders(fetched, policy);
      // Nothing permitted leaves the previous list standing rather than
      // emptying a store other screens read from; the spawn dialogs are the
      // ones that report the lockout, and Rust is what enforces it.
      if (cancelled || permitted.length === 0) return;
      state.setProviders(permitted);
      state.setDefaultProvider(permitted[0]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rootPath]);

  // The router callbacks must always see the latest handleRefresh without
  // recreating the router (a recreate would drop pending debounce timers).
  useEffect(() => {
    handleRefreshRef.current = handlers.handleRefresh;
  }, [handlers.handleRefresh]);

  // File watcher — events split into two debounce lanes: regular file changes
  // refresh the tree; project DB writes (MCP server, external agents) reload
  // the PM/requirements/goals data behind Mission Control's counts.
  // Built exactly once, in an effect rather than during render: recreating it
  // would drop the pending debounce timers, and the callbacks read everything
  // they need through refs and the store rather than this render's scope.
  useEffect(() => {
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
      onEvidenceChange: () => {
        // Lazy: the engine itself skips goals without machine predicates,
        // so a quiet project costs nothing here.
        const s = useStore.getState();
        if (s.goalStationsDraft.length === 0) return;
        void import('@/lib/evidence/engine').then((m) => {
          void m.checkFrontStations();
          // An out-of-band MCP agent may have claimed a station done; judge it.
          void m.checkClaimedStations();
        });
      },
    });
  }, []);

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
    useCallback(
      (event) => {
        updateAgentStatus(event.agentId, event.status);
        // An agent finishing is the moment its evidence lands: re-check the
        // front of the goal it worked, whether it succeeded or crashed.
        if (event.status === 'idle' || event.status === 'error') {
          const agent = useStore.getState().agents.find((a) => a.id === event.agentId);
          const goalId =
            agent?.spawnedByGoalId ??
            (agent?.spawnedByTicketId
              ? useStore
                  .getState()
                  .goalStationsDraft.find((s) => s.ticketId === agent.spawnedByTicketId)?.goalId
              : undefined);
          if (goalId) {
            void import('@/lib/evidence/engine').then((m) => {
              void m.checkFrontStations(goalId);
              // The agent may have claimed a station done — judge it now too.
              void m.checkClaimedStations(goalId);
            });
          }
        }
      },
      [updateAgentStatus]
    )
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
      // The separate judge model is configured independently.
      m.dbGet(path, 'judge_llm_settings', 'api_key').then((k) => {
        if (canceled) return;
        state.setJudgeLlmConfigured(!!k);
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

  // `state` and `handlers` are fresh objects every render — depending on them
  // would tear the global listener down and re-register it on each render.
  // The listener reads the freshest values through a ref instead and is
  // registered exactly once.
  const latest = useRef({ state, handlers });
  // After paint, not during render: the listener below only reads this from a
  // keyboard event, which cannot arrive before this render's effects have run.
  useEffect(() => {
    latest.current = { state, handlers };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { state, handlers } = latest.current;
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
      } else if (mod && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        state.setFindInFilesOpen(true);
      } else if (mod && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        void handlers.handleNewScratch();
      } else if (mod && e.key === 'b') {
        e.preventDefault();
        if (state.rootPath) state.setBottomCollapsed(!state.bottomCollapsed);
      } else if (mod && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        state.setActiveActivity('explorer');
      } else if (mod && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        state.setActiveActivity('source-control');
      } else if (mod && e.shiftKey && e.key === 'A') {
        // Jump to the next agent that needs a human — triage without
        // reaching for the mouse or scanning the panel. Inert while calm.
        e.preventDefault();
        const nextId = nextAttentionAgentId(
          withReviewFlags(state.agents, state.reviewedAgentIds),
          state.selectedAgentId,
          Date.now()
        );
        if (nextId) handlers.handleSelectAgent(nextId);
      } else if (mod && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        useStore.getState().toggleAgentConsole();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
