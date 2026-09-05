'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { openFolderDialog, createDirectory, writeFile } from '@/lib/tauri/fs';
import { openExternalUrl } from '@/lib/tauri/opener';
import { type AgentConfig } from '@/lib/tauri/agents';
import { persistQuietly } from '@/lib/store/persistFeedback';
import { isClosedTicketStatus } from '@/lib/pm/enums';
import { defaultCommands } from '@/lib/commands/registry';
import { TIPS, activityItems, visibleActivityItems } from '@/lib/ide/constants';
import { unsortedInboxItems } from '@/lib/inbox/unsortedInboxItems';
import { selectChangedFileCount } from '@/lib/store/gitSlice';
import {
  joinProjectPath,
  scaffoldProjectFiles,
  type NewProjectOptions,
} from '@/lib/project/newProject';
import { repoForGlobalGitAction } from './useGitActionHandlers';
import type { useIDEState } from '../useIDEState';

export const CONTEXT_BOUND_COMMANDS: Record<string, string> = {
  'agent.kill-all': 'Kill All lives in the Agents panel, per repository. It asks before it acts.',
  'canvas.toggle': 'Open a canvas file first; this switches the view of the active canvas.',
  'canvas.fit': 'Open a canvas file first; this fits the active canvas to the screen.',
  'markdown.rename-heading': 'Put the cursor on a heading in the editor, then press F2.',
  'markdown.find-references': 'Put the cursor on an entity in the editor, then press Alt+F7.',
  'markdown.extract-section': 'Put the cursor in the section you want to extract, in the editor.',
};

function contextBoundAction(id: string): () => void {
  const hint = CONTEXT_BOUND_COMMANDS[id];
  if (!hint) {
    return () => useStore.getState().showToast(`Command "${id}" has no action.`, 'error');
  }
  return () => useStore.getState().showToast(hint, 'info');
}

const DAILY_TIP = (() => {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return TIPS[dayOfYear % TIPS.length];
})();

export interface UseAgentAndCommandHandlersProps {
  state: ReturnType<typeof useIDEState>;
  handleRefresh: (dir?: string, isRoot?: boolean) => Promise<unknown>;
  leaveWorkPlace: () => Promise<boolean>;
  handleNewFile: () => Promise<void>;
  handleNewDiagram: (parentDir?: string) => Promise<void>;
  handleSave: () => Promise<void>;
  handleCommit: (repoPath: string) => Promise<void>;
  handleNewScratch: () => Promise<void>;
  showFileHistory: () => void;
}

export function useAgentAndCommandHandlers({
  state,
  handleRefresh,
  leaveWorkPlace,
  handleNewFile,
  handleNewDiagram,
  handleSave,
  handleCommit,
  handleNewScratch,
  showFileHistory,
}: UseAgentAndCommandHandlersProps) {
  const handleSelectionSpawn = useCallback(
    (selection: string) => {
      state.setInitialAgentTask(`Context Selection:\n${selection}\n\nTask: `);
      state.setSpawnDialogOpen(true);
    },
    [state]
  );

  const handleSpawnNewAgent = useCallback(
    async (config: AgentConfig) => {
      try {
        await state.spawnNewAgent(config);
      } catch {
        return;
      }
      state.setSpawnDialogOpen(false);
      if (config.spawnedByGoalId && state.rootPath) {
        await persistQuietly(useStore.getState().saveGoals(state.rootPath));
      }
    },
    [state]
  );

  const handleKillAgent = useCallback((id: string) => state.killRunningAgent(id), [state]);

  const handleSelectAgent = useCallback(
    (id: string | null) => {
      state.selectAgent(id);
      if (id) {
        const agent = state.agents.find((a) => a.id === id);
        if (agent) state.setFullscreenAgent(agent);
      }
    },
    [state]
  );

  const handleResumeInterrupted = useCallback(
    async (id: string) => {
      try {
        const agent = await state.resumeInterruptedAgent(id);
        state.setFullscreenAgent(agent);
      } catch (err) {
        console.error('Failed to resume interrupted agent', err);
      }
    },
    [state]
  );

  const handleOpenTerminalHere = useCallback(
    (folderPath: string) => {
      const id = `term-${Date.now()}`;
      const label = folderPath.split('/').pop() || folderPath;
      state.setExtraTerminals((prev) => [...prev, { id, label, cwd: folderPath }]);
      state.setBottomCollapsed(false);
    },
    [state]
  );

  const handleCloseTerminal = useCallback(
    (id: string) => {
      state.setExtraTerminals((prev) => prev.filter((t) => t.id !== id));
    },
    [state]
  );

  const loadProjectData = useCallback(
    (projectPath: string) => {
      void state.loadPmData(projectPath);
      void state.loadRequirements(projectPath);
      void state.loadGoals(projectPath);
      void state.loadExcalidrawSpecLinks(projectPath);
    },
    [state]
  );

  const clearProjectState = useCallback(() => {
    state.closeAllTabs();
    state.setFileTree([]);
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

  const handleOpenFolder = useCallback(async () => {
    const selected = await openFolderDialog();
    if (!selected) return;
    clearProjectState();
    state.setRootPath(selected);
    state.addRecentProject(selected);
    state.initProjectDb(selected);
    loadProjectData(selected);
    await handleRefresh(selected, true);
  }, [state, clearProjectState, handleRefresh, loadProjectData]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      clearProjectState();
      state.setRootPath(path);
      state.addRecentProject(path);
      state.initProjectDb(path);
      loadProjectData(path);
      await handleRefresh(path, true);
    },
    [state, clearProjectState, handleRefresh, loadProjectData]
  );

  const handleNewProject = useCallback(
    async ({ name, parentDir, template }: NewProjectOptions) => {
      const projectDir = joinProjectPath(parentDir, name);
      const files = scaffoldProjectFiles(projectDir, name, template);
      await createDirectory(projectDir);
      for (const file of files) {
        const parent = file.path.replace(/[\\/][^\\/]+$/, '');
        if (parent && parent !== projectDir) await createDirectory(parent);
        await writeFile(file.path, file.content);
      }
      clearProjectState();
      state.setRootPath(projectDir);
      state.addRecentProject(projectDir);
      state.initProjectDb(projectDir);
      loadProjectData(projectDir);
      await handleRefresh(projectDir, true);
    },
    [state, clearProjectState, handleRefresh, loadProjectData]
  );

  const handleActivitySelect = useCallback(
    async (id: string) => {
      if (id === 'cockpit') {
        if (useStore.getState().pmDirty) {
          if (!(await leaveWorkPlace())) return;
        } else {
          useStore.getState().closeWorkPlace();
        }
        state.setActiveTab(null);
        state.setActiveActivity('cockpit');
        return;
      }
      if (id === 'work') {
        useStore.getState().openWorkPlace();
        return;
      }
      if (id === 'project-mgmt' || id === 'goals') {
        useStore.getState().openWorkPlace(id === 'project-mgmt' ? 'tickets' : 'goals');
        return;
      }
      if (id === 'requirements') {
        useStore.getState().openWorkPlace('requirements');
        return;
      }
      if (id === 'goal-lines') {
        useStore.getState().openWorkPlace('lines');
        return;
      }
      if (id === 'settings') {
        state.setSettingsModalOpen(true);
        return;
      }
      if (id === 'graph') {
        state.setLinkGraphModalOpen(true);
        return;
      }
      if (id === 'blueprints') {
        state.setBlueprintsGalleryOpen(true);
        if (state.rootPath) state.loadBlueprints(state.rootPath);
        return;
      }
      if (useStore.getState().pmDirty) {
        if (!(await leaveWorkPlace())) return;
      } else {
        useStore.getState().closeWorkPlace();
      }
      state.setActiveActivity(id);
    },
    [state, leaveWorkPlace]
  );

  const handleProblemsClick = useCallback(() => {
    state.setBottomCollapsed(false);
    state.setBottomTab('problems');
    state.setProblemsPanelOpen(true);
  }, [state]);

  const commandActions = useMemo<Record<string, () => void>>(
    () => ({
      'file.new': handleNewFile,
      'file.open-folder': handleOpenFolder,
      'file.search': () => state.setFileSearchOpen(true),
      'file.advanced-selection': () => state.setFileSelectorOpen(true),
      'file.find-in-files': () => {
        if (state.rootPath) state.setFindInFilesOpen(true);
      },
      'file.save': handleSave,
      'file.new-scratch': () => void handleNewScratch(),
      'file.import-spec': () => state.setImportSpecDialogOpen(true),
      'file.import-video': () => state.setVideoImportDialogOpen(true),
      'git.commit': () => {
        const repoPath = repoForGlobalGitAction(useStore.getState());
        if (repoPath) void handleCommit(repoPath);
      },
      'git.stage-all': () => {
        const store = useStore.getState();
        const repoPath = repoForGlobalGitAction(store);
        if (repoPath) void store.stageAll(repoPath);
      },
      'git.unstage-all': () => {
        const store = useStore.getState();
        const repoPath = repoForGlobalGitAction(store);
        if (repoPath) void store.unstageAll(repoPath);
      },
      'git.show-changes': () => state.setActiveActivity('source-control'),
      'git.file-history': () => {
        state.setActiveActivity('source-control');
        showFileHistory();
      },
      'git.compare-with-branch': () => {
        state.setActiveActivity('source-control');
        const store = useStore.getState();
        store.setScmView('compare');
        const repoPath = repoForGlobalGitAction(store);
        if (repoPath) void store.loadBranches(repoPath);
      },
      'git.toggle-blame': () => useStore.getState().toggleBlame(),
      'git.next-hunk': () => useStore.getState().requestHunkNav('next'),
      'git.prev-hunk': () => useStore.getState().requestHunkNav('prev'),
      'agent.deploy': () => state.setSpawnDialogOpen(true),
      'agent.ascii-art': () => {
        state.setInitialAgentTask('Create an ASCII art representation of a futuristic AI logo.');
        state.setSpawnDialogOpen(true);
      },
      'view.toggle-sidebar': () =>
        document.querySelector<HTMLButtonElement>('[data-testid="toggle-left-panel"]')?.click(),
      'view.toggle-terminal': () => {
        if (!state.rootPath) return;
        document.querySelector<HTMLButtonElement>('[data-testid="toggle-bottom-panel"]')?.click();
      },
      'help.github': () => {
        void openExternalUrl('https://github.com/j-amelunxen/AuricIDE').catch(() => {
          /* clipboard fallback already ran inside openExternalUrl */
        });
      },
      'view.focus-explorer': () => state.setActiveActivity('explorer'),
      'view.focus-source-control': () => state.setActiveActivity('source-control'),
      'view.link-graph': () => state.setLinkGraphModalOpen(true),
      'view.cockpit': () => {
        void (async () => {
          if (!(await leaveWorkPlace())) return;
          state.setActiveTab(null);
          state.setActiveActivity('cockpit');
        })();
      },
      'view.goals': () => useStore.getState().openWorkPlace('goals'),
      'view.tickets': () => useStore.getState().openWorkPlace('tickets'),
      'view.requirements': () => useStore.getState().openWorkPlace('requirements'),
      'view.goal-lines': () => useStore.getState().openWorkPlace('lines'),
      'view.notifications': () => state.setActiveActivity('notifications'),
      'view.inbox': () => state.setActiveActivity('inbox'),
      'inbox.capture': () => useStore.getState().setInboxCaptureOpen(true),
      'view.agent-console': () => useStore.getState().toggleAgentConsole(),
      'view.command-center': () => {
        const store = useStore.getState();
        if (store.commandCenterOpen) store.closeCommandCenter();
        else store.openCommandCenter();
      },
      'excalidraw.new': () => void handleNewDiagram(),
      'excalidraw.browse': () => useStore.getState().setExcalidrawBrowserOpen(true),
      'excalidraw.sync-all': () => {
        const store = useStore.getState();
        if (!store.rootPath) return;
        void store.resyncAllSpecs(store.rootPath).then(({ synced, failed }) => {
          useStore
            .getState()
            .showToast(
              `Excalidraw+ specs: ${synced} synced${failed > 0 ? `, ${failed} failed` : ''}`,
              failed > 0 ? 'error' : 'success'
            );
        });
      },
    }),
    [
      state,
      handleNewFile,
      handleNewDiagram,
      handleOpenFolder,
      handleSave,
      handleCommit,
      handleNewScratch,
      showFileHistory,
      leaveWorkPlace,
    ]
  );

  const commands = useMemo(
    () =>
      defaultCommands.map((cmd) => ({
        ...cmd,
        action: commandActions[cmd.id] ?? contextBoundAction(cmd.id),
      })),
    [commandActions]
  );

  const performableCommandIds = useMemo(() => Object.keys(commandActions), [commandActions]);

  const handleCommandExecute = useCallback(
    (commandId: string) => {
      commands.find((c) => c.id === commandId)?.action();
      useStore.getState().recordCommandUse(commandId);
      state.setCommandPaletteOpen(false);
    },
    [commands, state]
  );

  const scBadge = selectChangedFileCount({ repoStates: state.repoStates });
  const openTicketsCount = useMemo(
    () => state.pmDraftTickets.filter((t) => !isClosedTicketStatus(t.status)).length,
    [state.pmDraftTickets]
  );
  const itemsWithBadge = useMemo(() => {
    const badged = activityItems.map((item) => {
      if (item.id === 'source-control')
        return { ...item, badge: scBadge > 0 ? scBadge : undefined };
      if (item.id === 'work')
        return { ...item, badge: openTicketsCount > 0 ? openTicketsCount : undefined };
      if (item.id === 'notifications')
        return {
          ...item,
          badge: state.notificationsUnreadCount > 0 ? state.notificationsUnreadCount : undefined,
        };
      if (item.id === 'inbox') {
        const unsorted = unsortedInboxItems(state.inboxItems ?? []).length;
        return { ...item, badge: unsorted > 0 ? unsorted : undefined };
      }
      return item;
    });
    return visibleActivityItems(badged, Boolean(state.rootPath));
  }, [scBadge, openTicketsCount, state.notificationsUnreadCount, state.inboxItems, state.rootPath]);

  const dailyTip = DAILY_TIP;

  return {
    handleSelectionSpawn,
    handleSpawnNewAgent,
    handleKillAgent,
    handleSelectAgent,
    handleResumeInterrupted,
    handleOpenTerminalHere,
    handleCloseTerminal,
    handleOpenFolder,
    handleOpenRecent,
    handleNewProject,
    handleActivitySelect,
    handleProblemsClick,
    commands,
    performableCommandIds,
    handleCommandExecute,
    itemsWithBadge,
    dailyTip,
  };
}
