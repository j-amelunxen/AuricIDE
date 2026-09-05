'use client';

import { useMemo, useState, memo } from 'react';
import { ActivityBar } from './components/ide/ActivityBar';
import { Header } from './components/ide/Header';
import { IDEShell } from './components/ide/IDEShell';
import { StatusBar } from './components/ide/StatusBar';
import { TabBar } from './components/editor/TabBar';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { AgentsPanel } from './components/agents/AgentsPanel';
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
import { extractTicket } from '@/lib/git/branchTicket';
import { repoLabel } from '@/lib/git/repos';
import { selectBranchNameForPath } from '@/lib/store/gitSlice';
import type { RepoView } from './components/git/SourceControlPanel';
import { useIDEState } from '@/lib/hooks/useIDEState';
import { type SettingsCategory } from './components/ide/SettingsModal';
import { useIDEActions } from '@/lib/hooks/useIDEActions';
import { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';
import { useAttentionTitle } from '@/lib/hooks/useAttentionTitle';
import { CloseWindowGuard } from '@/lib/hooks/useCloseWindowGuard';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { StartSplashScreen } from './components/ide/StartSplashScreen';
import { EditorContentRouter } from './components/ide/EditorContentRouter';
import { LeftSidebarPanel } from './components/ide/LeftSidebarPanel';
import { CanvasPageModals } from './components/ide/CanvasPageModals';

// Memoized sub-components
const MemoizedHeader = memo(Header);
const MemoizedActivityBar = memo(ActivityBar);
const MemoizedStatusBar = memo(StatusBar);
const MemoizedTabBar = memo(TabBar);
const MemoizedTerminalPanel = memo(TerminalPanel);
const MemoizedAgentsPanel = memo(AgentsPanel);

/**
 * A null leaf that owns the window-title/dock-badge mirroring. The hook ticks
 * on useNow — mounting it here instead of in Home keeps the 1 Hz timer off
 * the page root, which would otherwise re-render the whole IDE every second.
 */
function AttentionTitle({
  agents,
  reviewedAgentIds,
}: {
  agents: AgentInfo[];
  reviewedAgentIds: string[];
}): null {
  useAttentionTitle(agents, reviewedAgentIds);
  return null;
}

export default function Home() {
  const state = useIDEState();
  const handlers = useIDEHandlers(state);
  useIDEActions(state, handlers);
  const openAgentConsole = useStore((s) => s.openAgentConsole);
  const diffTab = useStore((s) => (s.activeTabId ? s.diffByTabId[s.activeTabId] : undefined));
  const scmView = useStore((s) => s.scmView);
  const historyPath = useStore((s) => s.historyPath);
  const historyCommits = useStore((s) => s.historyCommits);
  const historySelectedOid = useStore((s) => s.historySelectedOid);
  const historyLoading = useStore((s) => s.historyLoading);
  const branches = useStore((s) => s.branches);
  const compareRef = useStore((s) => s.compareRef);
  const compareFiles = useStore((s) => s.compareFiles);
  const compareLoading = useStore((s) => s.compareLoading);
  const branchName = useStore((s) => selectBranchNameForPath(s, state.activeTabId));

  const repoViews = useMemo<RepoView[]>(
    () =>
      state.repos.map((repo) => {
        const repoState = state.repoStates[repo.path];
        const branchName = repoState?.branchInfo?.name ?? null;
        return {
          repoPath: repo.path,
          label: repoLabel(repo),
          kind: repo.kind,
          branchName,
          ticketPrefix:
            extractTicket(branchName ?? '', state.agentSettings.branchTicketPattern) ?? undefined,
          fileStatuses: (repoState?.fileStatuses ?? []).filter((s) => s.status !== 'ignored'),
          commitMessage: repoState?.commitMessage ?? '',
          isCommitting: repoState?.isCommitting ?? false,
          isPushing: repoState?.isPushing ?? false,
        };
      }),
    [state.repos, state.repoStates, state.agentSettings.branchTicketPattern]
  );

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const handleCreateProject = async (options: NewProjectOptions) => {
    await handlers.handleNewProject(options);
    setNewProjectOpen(false);
  };

  const leftPanelContent = useMemo(
    () => (
      <LeftSidebarPanel
        state={state}
        handlers={handlers}
        repoViews={repoViews}
        scmView={scmView}
        historyPath={historyPath}
        historyCommits={historyCommits}
        historySelectedOid={historySelectedOid}
        historyLoading={historyLoading}
        branches={branches}
        compareRef={compareRef}
        compareFiles={compareFiles}
        compareLoading={compareLoading}
      />
    ),
    [
      state,
      handlers,
      repoViews,
      scmView,
      historyPath,
      historyCommits,
      historySelectedOid,
      historyLoading,
      branches,
      compareRef,
      compareFiles,
      compareLoading,
    ]
  );

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
      <IDEOverlays {...state} {...handlers} />
      <ToastHost />
      <CanvasPageModals state={state} handlers={handlers} />
      <AttentionTitle agents={state.agents} reviewedAgentIds={state.reviewedAgentIds} />
      <ExcalidrawBrowser
        onImported={() => void handlers.handleRefresh()}
        onOpenSettings={() => state.setSettingsModalOpen(true)}
      />
      <OrchestrationModal />
      <NewProjectModal
        isOpen={newProjectOpen}
        onCreate={handleCreateProject}
        onClose={() => setNewProjectOpen(false)}
      />
      <IDEShell
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
            onCommandPalette={() => state.setCommandPaletteOpen(true)}
            onShowAgents={() => state.setRightCollapsed(false)}
            onOpenSettings={(category) => {
              if (category) {
                state.setSettingsInitialCategory(category as SettingsCategory);
              }
              state.setSettingsModalOpen(true);
            }}
          />
        }
        activityBar={
          <MemoizedActivityBar
            items={handlers.itemsWithBadge}
            activeId={state.workPlaceOpen ? 'work' : state.activeActivity}
            onSelect={handlers.handleActivitySelect}
            onTerminalToggle={
              state.rootPath ? () => state.setBottomCollapsed(!state.bottomCollapsed) : undefined
            }
            onAgentsToggle={() => state.setRightCollapsed(!state.rightCollapsed)}
          />
        }
        leftPanel={leftPanelContent}
        centerContent={
          <div className="flex h-full min-w-0 flex-col">
            <MemoizedTabBar
              tabs={tabsWithIcons}
              activeTabId={state.workPlaceOpen ? null : state.activeTabId}
              onSelect={(id) => {
                if (useStore.getState().pmDirty) {
                  void (async () => {
                    if (!(await handlers.leaveWorkPlace())) return;
                    state.setActiveTab(id);
                  })();
                  return;
                }
                useStore.getState().closeWorkPlace();
                state.setActiveTab(id);
              }}
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
                <EditorContentRouter state={state} handlers={handlers} diffTab={diffTab} />
              </div>
            ) : state.rootPath ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <MissionControl
                  onCreateSpec={() => void handlers.handleNewSpec()}
                  onOpenAgents={() => state.setRightCollapsed(false)}
                  onSwitchProject={(path) => handlers.handleOpenRecent(path)}
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
          <MemoizedAgentsPanel
            agents={state.agents}
            interruptedAgents={state.interruptedAgents}
            onSpawn={() => state.setSpawnDialogOpen(true)}
            onKill={handlers.handleKillAgent}
            onKillRepo={state.killAgentsForRepoPath}
            onSelectAgent={handlers.handleSelectAgent}
            onImageDrop={handlers.handleImageDrop}
            onCollapse={() => state.setRightCollapsed(true)}
            onOpenConsole={openAgentConsole}
            onResumeInterrupted={handlers.handleResumeInterrupted}
            onDiscardInterrupted={state.discardInterruptedAgent}
            minimizedAgentIds={state.minimizedAgentIds}
            onToggleMinimize={state.setAgentMinimized}
            onRename={state.renameRunningAgent}
            onDismissFinished={state.dismissFinishedAgent}
            collapsedRepos={state.collapsedAgentRepos}
            onToggleRepoCollapsed={state.toggleAgentRepoCollapsed}
            agentColors={state.agentColors}
            onSetColor={state.setAgentColor}
            reviewedAgentIds={state.reviewedAgentIds}
            onRetryFailed={state.retryFailedAgent}
          />
        }
        bottomPanel={
          state.rootPath ? (
            <BottomPanelTabs
              activeTab={state.bottomTab}
              onTabChange={state.setBottomTab}
              problemCount={handlers.activeDiagCounts.errors + handlers.activeDiagCounts.warnings}
              terminalContent={
                <MemoizedTerminalPanel
                  agents={state.agents}
                  selectedAgentId={state.selectedAgentId}
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
          <MemoizedStatusBar
            branch={branchName ?? 'main'}
            encoding="UTF-8"
            language={handlers.activeLanguage}
            cursorPos={state.cursorPos}
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
