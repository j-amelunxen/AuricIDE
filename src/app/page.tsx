'use client';

import { useCallback, useMemo, useState, memo } from 'react';
import { ActivityBar } from './components/ide/ActivityBar';
import { Header } from './components/ide/Header';
import { IDEShell } from './components/ide/IDEShell';
import { TabBar } from './components/editor/TabBar';
import { IDEOverlays } from './components/ide/IDEOverlays';
import { ToastHost } from './components/ide/ToastHost';
import { BottomPanelTabs } from './components/ide/BottomPanelTabs';
import { ProblemsPanel } from './components/problems/ProblemsPanel';
import { isScratchPath } from '@/lib/scratch/naming';
import { MissionControl } from './components/cockpit/MissionControl';
import { ExcalidrawBrowser } from './components/excalidraw/ExcalidrawBrowser';
import { OrchestrationModal } from './components/goals/OrchestrationModal';
import { WorkView } from './components/work/WorkView';
import { NewProjectModal, type NewProjectOptions } from './components/ide/NewProjectModal';
import { selectBranchNameForPath } from '@/lib/store/gitSlice';
import { useIDEState } from '@/lib/hooks/useIDEState';
import { useLiveIDEState } from '@/lib/hooks/ide/liveIDEState';
import { type SettingsCategory } from './components/ide/SettingsModal';
import { useIDEActions } from '@/lib/hooks/useIDEActions';
import { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';
import { CloseWindowGuard } from '@/lib/hooks/useCloseWindowGuard';
import { useStore } from '@/lib/store';
import { StartSplashScreen } from './components/ide/StartSplashScreen';
import { EditorContentRouter } from './components/ide/EditorContentRouter';
import { LeftSidebarPanel } from './components/ide/LeftSidebarPanel';
import { leftPanelVisible } from '@/lib/ide/leftPanel';
import { CanvasPageModals } from './components/ide/CanvasPageModals';
import {
  AttentionTitle,
  BackgroundWatchers,
  ConnectedAgentsPanel,
  ConnectedStatusBar,
  ConnectedTerminalPanel,
} from './components/ide/ConnectedPanels';

// Memoized sub-components
const MemoizedHeader = memo(Header);
const MemoizedActivityBar = memo(ActivityBar);
const MemoizedTabBar = memo(TabBar);
const MemoizedMissionControl = memo(MissionControl);

/*
 * Render discipline for this page: every store write to a field `Home`
 * selects re-renders the page, so hot fields are selected by the panels that
 * show them (`ConnectedPanels`, `LeftSidebarPanel`) and the page passes only
 * stable callbacks and slow-changing values to its memoized children. The
 * callbacks close over `state`, the live view from `useLiveIDEState`: its
 * identity never changes and its reads are always current, so a callback
 * built with `[state]` stays the same function for the page's lifetime.
 * `page.test.tsx` counts panel renders to keep this honest.
 */
// code-gate: complexity-function-length - composition root: the length is the panel layout JSX
export default function Home() {
  const pageState = useIDEState();
  const state = useLiveIDEState(pageState);
  const handlers = useIDEHandlers(state);
  useIDEActions(state, handlers);
  const diffTab = useStore((s) => (s.activeTabId ? s.diffByTabId[s.activeTabId] : undefined));
  const branchName = useStore((s) => selectBranchNameForPath(s, state.activeTabId));

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const handleCreateProject = async (options: NewProjectOptions) => {
    await handlers.handleNewProject(options);
    setNewProjectOpen(false);
  };

  const leftPanelShown = leftPanelVisible({
    activeActivity: state.activeActivity,
    availableIds: handlers.itemsWithBadge.map((item) => item.id),
    collapsed: state.leftCollapsed,
  });

  const { leaveWorkPlace, handleRefresh, handleNewSpec, handleOpenRecent } = handlers;
  const openCommandPalette = useCallback(() => state.setCommandPaletteOpen(true), [state]);
  const showAgents = useCallback(() => state.setRightCollapsed(false), [state]);
  const hideAgents = useCallback(() => state.setRightCollapsed(true), [state]);
  const toggleAgents = useCallback(() => state.setRightCollapsed(!state.rightCollapsed), [state]);
  const toggleTerminal = useCallback(
    () => state.setBottomCollapsed(!state.bottomCollapsed),
    [state]
  );
  const openSpawnDialog = useCallback(() => state.setSpawnDialogOpen(true), [state]);
  const openSettings = useCallback(
    (category?: string) => {
      if (category) {
        state.setSettingsInitialCategory(category as SettingsCategory);
      }
      state.setSettingsModalOpen(true);
    },
    [state]
  );
  const selectTab = useCallback(
    (id: string) => {
      if (useStore.getState().pmDirty) {
        void (async () => {
          if (!(await leaveWorkPlace())) return;
          state.setActiveTab(id);
        })();
        return;
      }
      useStore.getState().closeWorkPlace();
      state.setActiveTab(id);
    },
    [state, leaveWorkPlace]
  );
  const createSpec = useCallback(() => void handleNewSpec(), [handleNewSpec]);
  const switchProject = useCallback((path: string) => handleOpenRecent(path), [handleOpenRecent]);
  const refreshAfterImport = useCallback(() => void handleRefresh(), [handleRefresh]);
  const openSettingsModal = useCallback(() => state.setSettingsModalOpen(true), [state]);

  // Scratch tabs carry a marker icon; "is scratch" is derived from the path
  // prefix, so the Tab model itself stays untouched.
  const tabsWithIcons = useMemo(
    () =>
      state.openTabs.map((tab) =>
        isScratchPath(tab.path, state.scratchDir) ? { ...tab, icon: 'sticky_note_2' } : tab
      ),
    [state.openTabs, state.scratchDir]
  );

  return (
    <>
      <CloseWindowGuard />
      <IDEOverlays {...pageState} {...handlers} />
      <ToastHost />
      <CanvasPageModals state={pageState} handlers={handlers} />
      <AttentionTitle />
      <BackgroundWatchers openProject={handlers.handleOpenRecent} />
      <ExcalidrawBrowser onImported={refreshAfterImport} onOpenSettings={openSettingsModal} />
      <OrchestrationModal />
      <NewProjectModal
        isOpen={newProjectOpen}
        onCreate={handleCreateProject}
        onClose={() => setNewProjectOpen(false)}
      />
      <IDEShell
        leftCollapsed={!leftPanelShown}
        onLeftToggle={state.setLeftCollapsed}
        bottomCollapsed={state.bottomCollapsed}
        onBottomToggle={state.setBottomCollapsed}
        rightCollapsed={state.rightCollapsed}
        onRightToggle={state.setRightCollapsed}
        header={
          <MemoizedHeader
            breadcrumbs={handlers.breadcrumbs}
            headingBreadcrumbs={handlers.headingBreadcrumbs}
            onHeadingBreadcrumbClick={state.setScrollToLine}
            isConnected={state.cliConnected}
            llmConfigured={state.llmConfigured}
            onCommandPalette={openCommandPalette}
            onShowAgents={showAgents}
            onOpenSettings={openSettings}
          />
        }
        activityBar={
          <MemoizedActivityBar
            items={handlers.itemsWithBadge}
            activeId={state.workPlaceOpen ? 'work' : state.activeActivity}
            onSelect={handlers.handleActivitySelect}
            onTerminalToggle={state.rootPath ? toggleTerminal : undefined}
            onAgentsToggle={toggleAgents}
          />
        }
        leftPanel={<LeftSidebarPanel state={pageState} handlers={handlers} />}
        centerContent={
          <div className="flex h-full min-w-0 flex-col">
            <MemoizedTabBar
              tabs={tabsWithIcons}
              activeTabId={state.workPlaceOpen ? null : state.activeTabId}
              onSelect={selectTab}
              onClose={state.closeTab}
              onCloseOthers={state.closeOtherTabs}
              onCloseAll={state.closeAllTabs}
              onCloseToRight={state.closeTabsToRight}
            />
            {state.workPlaceOpen ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <WorkView />
              </div>
            ) : state.activeTabId ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <EditorContentRouter state={pageState} handlers={handlers} diffTab={diffTab} />
              </div>
            ) : state.rootPath ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <MemoizedMissionControl
                  onCreateSpec={createSpec}
                  onOpenAgents={showAgents}
                  onSwitchProject={switchProject}
                  onCloseProject={handlers.handleCloseProject}
                />
              </div>
            ) : (
              <StartSplashScreen
                onOpenFolder={handlers.handleOpenFolder}
                onNewProject={() => setNewProjectOpen(true)}
                onOpenRecent={(path) => handlers.handleOpenRecent(path)}
                dailyTip={handlers.dailyTip}
              />
            )}
          </div>
        }
        rightPanel={
          <ConnectedAgentsPanel
            onSpawn={openSpawnDialog}
            onKill={handlers.handleKillAgent}
            onSelectAgent={handlers.handleSelectAgent}
            onImageDrop={handlers.handleImageDrop}
            onCollapse={hideAgents}
            onResumeInterrupted={handlers.handleResumeInterrupted}
          />
        }
        bottomPanel={
          state.rootPath ? (
            <BottomPanelTabs
              activeTab={state.bottomTab}
              onTabChange={state.setBottomTab}
              problemCount={handlers.activeDiagCounts.errors + handlers.activeDiagCounts.warnings}
              terminalContent={
                <ConnectedTerminalPanel
                  onSelectAgent={handlers.handleSelectAgent}
                  rootPath={state.rootPath}
                  extraTerminals={state.extraTerminals}
                  onCloseTerminal={handlers.handleCloseTerminal}
                />
              }
              problemsContent={
                <ProblemsPanel
                  diagnostics={handlers.activeDiagnostics}
                  filePath={state.activeTabId ?? ''}
                  onClose={() => {
                    state.setBottomTab('terminal');
                    state.setProblemsPanelOpen(false);
                  }}
                  onNavigate={(line) => {
                    state.setScrollToLine(line);
                    state.setBottomTab('terminal');
                  }}
                />
              }
            />
          ) : undefined
        }
        statusBar={
          <ConnectedStatusBar
            branch={branchName ?? 'main'}
            encoding="UTF-8"
            language={handlers.activeLanguage}
            errorCount={handlers.activeDiagCounts.errors}
            warningCount={handlers.activeDiagCounts.warnings}
            onProblemsClick={handlers.handleProblemsClick}
          />
        }
      />
      {handlers.confirmDialog}
    </>
  );
}
