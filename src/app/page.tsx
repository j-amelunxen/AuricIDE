'use client';

import { useMemo, useState, memo } from 'react';
import { ActivityBar } from './components/ide/ActivityBar';
import { Header } from './components/ide/Header';
import { IDEShell } from './components/ide/IDEShell';
import { StatusBar } from './components/ide/StatusBar';
import { FileExplorer } from './components/explorer/FileExplorer';
import { TabBar } from './components/editor/TabBar';
import { MarkdownEditor } from './components/editor/MarkdownEditor';
import { ImageViewer } from './components/editor/ImageViewer';
import { VideoViewer } from './components/editor/VideoViewer';
import { PDFViewer } from './components/editor/PDFViewer';
import { HtmlViewer } from './components/editor/HtmlViewer';
import { SourceControlPanel } from './components/git/SourceControlPanel';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { AgentsPanel } from './components/agents/AgentsPanel';
import { DiffViewer } from './components/editor/DiffViewer';
import { CanvasView } from './components/canvas/CanvasView';
import { ObsidianCanvasView } from './components/obsidian-canvas/ObsidianCanvasView';
import { MindmapView } from './components/mindmap/MindmapView';
import { IDEOverlays } from './components/ide/IDEOverlays';
import { ToastHost } from './components/ide/ToastHost';
import { OutlinePanel } from './components/outline/OutlinePanel';
import { BottomPanelTabs } from './components/ide/BottomPanelTabs';
import { ProblemsPanel } from './components/problems/ProblemsPanel';
import { ExtensionsPanel } from './components/ide/ExtensionsPanel';
import { QAPanel } from './components/qa/QAPanel';
import { ScratchPanel } from './components/scratch/ScratchPanel';
import { NotificationsSidebar } from './components/notifications/NotificationsSidebar';
import { InboxPanel } from './components/inbox/InboxPanel';
import { InboxCapture } from './components/inbox/InboxCapture';
import { isScratchPath } from '@/lib/scratch/naming';
import { ContextMenu, type ContextMenuOption } from './components/ide/ContextMenu';
import { MissionControl } from './components/cockpit/MissionControl';
import { ProjectSwitcher } from './components/cockpit/ProjectSwitcher';
import { StartScreenAgentsLine } from './components/cockpit/StartScreenAgentsLine';
import { ExcalidrawViewer } from './components/excalidraw/ExcalidrawViewer';
import { ExcalidrawBrowser } from './components/excalidraw/ExcalidrawBrowser';
import { OBSIDIAN_COLORS } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianColor, ObsidianNode } from '@/lib/obsidian-canvas/types';
import { TicketCreateModal } from './components/pm/TicketCreateModal';
import { OrchestrationModal } from './components/goals/OrchestrationModal';
import { WorkView } from './components/work/WorkView';
import { NewProjectModal, type NewProjectOptions } from './components/ide/NewProjectModal';
import { AuricIcon } from './components/ui/AuricIcon';
import { extractTicket } from '@/lib/git/branchTicket';
import { repoLabel } from '@/lib/git/repos';
import { selectBranchNameForPath } from '@/lib/store/gitSlice';
import type { RepoView } from './components/git/SourceControlPanel';
import { useIDEState } from '@/lib/hooks/useIDEState';
import { type SettingsCategory } from './components/ide/SettingsModal';
import { useIDEActions } from '@/lib/hooks/useIDEActions';
import { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';
import { useAttentionTitle } from '@/lib/hooks/useAttentionTitle';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';

// Memoized sub-components
const MemoizedHeader = memo(Header);
const MemoizedActivityBar = memo(ActivityBar);
const MemoizedStatusBar = memo(StatusBar);
const MemoizedFileExplorer = memo(FileExplorer);
const MemoizedTabBar = memo(TabBar);
const MemoizedTerminalPanel = memo(TerminalPanel);
const MemoizedAgentsPanel = memo(AgentsPanel);

const CANVAS_COLOR_OPTIONS: { key: ObsidianColor; label: string }[] = [
  { key: '1', label: 'Red' },
  { key: '2', label: 'Orange' },
  { key: '3', label: 'Yellow' },
  { key: '4', label: 'Green' },
  { key: '5', label: 'Teal' },
  { key: '6', label: 'Purple' },
];

function buildCanvasContextMenuOptions(
  nodeId: string,
  nodes: ObsidianNode[],
  onColorChange: (nodeId: string, color: ObsidianColor | undefined) => void,
  onCreateTicket: (nodeId: string) => void
): ContextMenuOption[] {
  const node = nodes.find((n) => n.id === nodeId);
  const canCreateTicket = node && (node.type === 'text' || node.type === 'file');

  return [
    ...(canCreateTicket
      ? [
          {
            label: 'Create Ticket from Note',
            icon: 'confirmation_number',
            action: () => onCreateTicket(nodeId),
          },
          { type: 'separator' as const },
        ]
      : []),
    { type: 'header', label: 'Color' },
    ...CANVAS_COLOR_OPTIONS.map(({ key, label }) => ({
      label,
      icon: 'circle',
      iconColor: OBSIDIAN_COLORS[key],
      action: () => onColorChange(nodeId, key),
    })),
    { type: 'separator' },
    {
      label: 'Remove color',
      icon: 'format_color_reset',
      action: () => onColorChange(nodeId, undefined),
    },
  ];
}

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

  const leftPanelContent = useMemo(() => {
    switch (state.activeActivity) {
      case 'explorer':
        return (
          <div className="flex h-full flex-col bg-panel-bg">
            <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/2">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
                Explorer
              </h2>
              {state.rootPath && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-primary-light bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                    {state.rootPath.split('/').pop()}
                  </span>
                  <button
                    onClick={handlers.handleCloseProject}
                    className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5"
                  >
                    <AuricIcon name="close" className="text-[14px]" />
                  </button>
                </div>
              )}
            </div>
            <MemoizedFileExplorer
              // Passed straight from the store: FileNode and FileTreeNode are
              // structurally identical, so the deep clone this used to go
              // through bought nothing and handed `memo` a new array on every
              // render — which is every 2s while an agent streams.
              tree={state.fileTree}
              selectedPath={state.selectedPath}
              selectedPaths={state.selectedPaths}
              selectionAnchor={state.selectionAnchor}
              onSelectFile={handlers.handleFileSelect}
              onToggleDir={handlers.handleToggleDir}
              onFocusNode={handlers.handleFocusNode}
              onToggleSelect={handlers.handleToggleSelect}
              onRangeSelect={handlers.handleRangeSelect}
              onClearSelection={handlers.handleClearSelection}
              onDeleteSelection={handlers.handleDeleteSelection}
              onRenameRequest={handlers.handleRenameRequest}
              onNewFile={handlers.handleNewFile}
              onRefresh={handlers.handleRefresh}
              onOpenFolder={handlers.handleOpenFolder}
              onContextMenu={handlers.handleContextMenu}
              onRootContextMenu={handlers.handleRootContextMenu}
              onMoveNode={handlers.handleMoveNode}
              rootPath={state.rootPath}
            />
          </div>
        );
      case 'source-control':
        return (
          <SourceControlPanel
            repos={repoViews}
            agenticCommit={state.agentSettings.agenticCommit}
            onCommitMessageChange={state.setCommitMessage}
            onCommit={handlers.handleCommit}
            onPush={handlers.handlePush}
            onStageFile={state.stageFile}
            onUnstageFile={state.unstageFile}
            onStageAll={state.stageAll}
            onUnstageAll={state.unstageAll}
            onFileClick={handlers.handleDiffFileClick}
            scmView={scmView}
            onScmViewChange={handlers.handleScmViewChange}
            activeRepoPath={state.activeRepoPath}
            onActiveRepoChange={handlers.handleActiveRepoChange}
            historyPath={historyPath}
            historyCommits={historyCommits}
            historySelectedOid={historySelectedOid}
            historyLoading={historyLoading}
            onHistoryCommitClick={handlers.handleHistoryCommitClick}
            branches={branches}
            compareRef={compareRef}
            compareFiles={compareFiles}
            compareLoading={compareLoading}
            onCompareRefChange={handlers.handleCompareRefChange}
            onCompareFileClick={handlers.handleCompareFileClick}
            onDiscardFile={handlers.handleDiscardFile}
            onAgenticToggle={(value) => state.updateAgentSettings({ agenticCommit: value })}
            providers={state.providers}
            selectedProviderId={state.agentSettings.commitProviderId || state.defaultProvider.id}
            onProviderChange={(id) => state.updateAgentSettings({ commitProviderId: id })}
            onRefresh={() => handlers.handleRefresh()}
          />
        );
      case 'outline':
        return (
          <OutlinePanel
            content={state.editorContent}
            cursorLine={state.cursorPos.line}
            isMarkdown={
              !state.activeTabId ||
              state.activeTabId.endsWith('.md') ||
              state.activeTabId.endsWith('.markdown')
            }
            onHeadingClick={(line) => state.setScrollToLine(line)}
          />
        );
      case 'extensions':
        return <ExtensionsPanel />;
      case 'qa':
        return <QAPanel />;
      case 'scratches':
        return (
          <ScratchPanel
            scratches={state.scratches}
            activeTabId={state.activeTabId}
            onCreate={() => void handlers.handleNewScratch()}
            onOpen={handlers.handleFileSelect}
            onRename={(path, newName) => void handlers.handleRenameScratch(path, newName)}
            onDelete={(path) => void handlers.handleDeleteScratch(path)}
            onDeleteAll={() => void handlers.handleCleanAllScratches()}
            onRefresh={() => void state.refreshScratches()}
          />
        );
      case 'notifications':
        // Self-contained: it reads the store itself and owns the 1-second
        // clock, so the rest of the IDE does not re-render with it.
        return (
          <NotificationsSidebar
            onRunCommand={handlers.handleCommandExecute}
            onOpenProject={handlers.handleOpenRecent}
          />
        );
      case 'inbox':
        // Also self-contained — its data is kept warm app-wide by
        // useInboxData, independent of whether this panel is even mounted.
        return <InboxPanel variant="sidebar" onOpenProject={handlers.handleOpenRecent} />;
      default:
        return null;
    }
  }, [
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
  ]);

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
      <IDEOverlays {...state} {...handlers} />
      <ToastHost />
      {state.canvasContextMenu && (
        <ContextMenu
          x={state.canvasContextMenu.x}
          y={state.canvasContextMenu.y}
          options={buildCanvasContextMenuOptions(
            state.canvasContextMenu.nodeId,
            state.ocNodes,
            handlers.handleOcNodeColorChange,
            handlers.handleCreateTicketFromNode
          )}
          onClose={() => state.setCanvasContextMenu(null)}
        />
      )}
      {state.canvasTicketCreate && (
        <TicketCreateModal
          isOpen
          epics={state.pmDraftEpics}
          allTickets={state.pmDraftTickets}
          availableItems={[]}
          defaultEpicId={null}
          initialValues={state.canvasTicketCreate.initialValues}
          onSave={handlers.handleCanvasTicketSave}
          onSaveAndClose={(data, deps) => {
            handlers.handleCanvasTicketSave(data, deps);
            state.setCanvasTicketCreate(null);
          }}
          onClose={() => state.setCanvasTicketCreate(null)}
        />
      )}
      {state.fileTicketCreate && (
        <TicketCreateModal
          isOpen
          epics={state.pmDraftEpics}
          allTickets={state.pmDraftTickets}
          availableItems={[]}
          defaultEpicId={null}
          initialValues={state.fileTicketCreate.initialValues}
          onSave={handlers.handleFileTicketSave}
          onSaveAndClose={(data, deps) => {
            handlers.handleFileTicketSave(data, deps);
            state.setFileTicketCreate(null);
          }}
          onClose={() => state.setFileTicketCreate(null)}
        />
      )}
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
          <div className="flex h-full flex-col">
            <MemoizedTabBar
              tabs={tabsWithIcons}
              activeTabId={state.workPlaceOpen ? null : state.activeTabId}
              onSelect={(id) => {
                useStore.getState().closeWorkPlace();
                state.setActiveTab(id);
              }}
              onClose={state.closeTab}
              onCloseOthers={state.closeOtherTabs}
              onCloseAll={state.closeAllTabs}
              onCloseToRight={state.closeTabsToRight}
            />
            {state.workPlaceOpen ? (
              <div className="flex-1 overflow-hidden">
                <WorkView />
              </div>
            ) : state.activeTabId ? (
              <div className="flex-1 overflow-hidden">
                {handlers.isDiffTab && diffTab ? (
                  <DiffViewer
                    diff={diffTab.patch}
                    fileName={diffTab.filePath}
                    repoPath={diffTab.repoPath}
                    source={diffTab.source}
                  />
                ) : state.imageData ? (
                  <ImageViewer
                    src={state.imageData}
                    fileName={state.activeTabId.split('/').pop() || ''}
                  />
                ) : state.videoSrc ? (
                  <VideoViewer
                    src={state.videoSrc}
                    fileName={state.activeTabId.split('/').pop() || ''}
                  />
                ) : state.pdfData ? (
                  <PDFViewer
                    src={state.pdfData}
                    fileName={state.activeTabId.split('/').pop() || ''}
                  />
                ) : handlers.isObsidianCanvas ? (
                  <ObsidianCanvasView
                    nodes={state.ocNodes}
                    edges={state.ocEdges}
                    onNodesChange={handlers.handleOcNodesChange}
                    onEdgesChange={handlers.handleOcEdgesChange}
                    onTextEdit={handlers.handleOcTextEdit}
                    onResize={handlers.handleOcResize}
                    onFileOpen={handlers.handleOcFileOpen}
                    onNodeSelect={state.selectOcNode}
                    loadFileContent={handlers.loadFileContent}
                    onFileDrop={handlers.handleOcFileDrop}
                    onNodeContextMenu={handlers.handleOcNodeContextMenu}
                    onTicketClick={handlers.handleTicketBadgeClick}
                  />
                ) : handlers.isWorkflowFile ? (
                  <CanvasView
                    nodes={state.canvasNodes}
                    edges={state.canvasEdges}
                    onNodesChange={handlers.handleCanvasNodesChange}
                    onNodeSelect={state.selectNode}
                  />
                ) : handlers.isMindmapTab && state.mindmapData ? (
                  <MindmapView
                    nodes={state.mindmapData.nodes}
                    edges={state.mindmapData.edges}
                    onNodeEdit={handlers.handleMindmapNodeEdit}
                    onNodesChange={handlers.handleMindmapNodesChange}
                  />
                ) : handlers.isExcalidrawTab ? (
                  <ExcalidrawViewer
                    content={state.editorContent}
                    filePath={state.activeTabId}
                    onReload={() => void handlers.loadTabContent(state.activeTabId!)}
                  />
                ) : handlers.isHtmlTab ? (
                  <HtmlViewer
                    content={state.editorContent}
                    fileName={state.activeTabId.split('/').pop() || ''}
                  />
                ) : (
                  <MarkdownEditor
                    content={state.editorContent}
                    filePath={state.activeTabId}
                    projectFiles={state.projectFiles}
                    scrollToLine={state.scrollToLine}
                    onChange={handlers.handleEditorChange}
                    onCursorChange={state.setCursorPos}
                    onSelectionSpawn={handlers.handleSelectionSpawn}
                    onWikiLinkNavigate={handlers.handleWikiLinkNavigate}
                  />
                )}
              </div>
            ) : state.rootPath ? (
              <div className="flex-1 overflow-hidden">
                <MissionControl
                  onCreateSpec={() => void handlers.handleNewSpec()}
                  onOpenAgents={() => state.setRightCollapsed(false)}
                  onSwitchProject={(path) => handlers.handleOpenRecent(path)}
                />
              </div>
            ) : (
              // items-center only (not justify-center): the hero's position
              // comes from the top padding, not from centering the whole
              // column's height. A wide inbox summary growing underneath it
              // must not walk the title around the screen.
              <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pt-[12vh] pb-12 text-center">
                <div className="w-full animate-in fade-in zoom-in duration-700">
                  <h1 className="font-display text-5xl font-black text-white tracking-tighter">
                    AURIC
                    <span className="text-primary-light font-thin tracking-widest ml-2">IDE</span>
                  </h1>
                  <p className="mt-4 text-sm text-foreground-muted uppercase tracking-[0.3em] font-medium">
                    AI-native Development
                  </p>
                  <div
                    data-testid="start-buttons-row"
                    className="mt-6 flex items-center justify-center gap-3"
                  >
                    <button
                      onClick={handlers.handleOpenFolder}
                      className="rounded-xl bg-primary/10 border border-primary/20 px-8 py-3 text-sm font-bold text-primary-light transition-[background-color,box-shadow] duration-150 hover:bg-primary/20 hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.2)] active:scale-[0.98]"
                    >
                      Open Project Folder
                    </button>
                    <button
                      onClick={() => setNewProjectOpen(true)}
                      data-testid="new-project-button"
                      className="flex items-center gap-2 rounded-xl border border-white/10 px-6 py-3 text-sm font-bold text-foreground transition-[background-color,border-color] duration-150 hover:bg-white/5 hover:border-white/20 active:scale-[0.98]"
                    >
                      <AuricIcon name="add" className="text-[18px]" />
                      New
                    </button>
                  </div>
                  <div data-testid="start-inbox-capture" className="mx-auto mt-6 w-full max-w-3xl">
                    <InboxCapture autoFocus />
                  </div>
                  <div data-testid="start-project-switcher" className="mt-6 flex justify-center">
                    <ProjectSwitcher
                      currentPath={null}
                      onOpenProject={(path) => handlers.handleOpenRecent(path)}
                    />
                  </div>
                  {/* Same width as the switcher above it: two blocks sharing
                      one edge read as a column, two different widths read as
                      clutter. Swaps to a running-agents line the moment
                      there is something more useful to say than a tip. */}
                  <StartScreenAgentsLine dailyTip={handlers.dailyTip} />
                  {/* Nothing renders here until the inbox holds something —
                      an empty inbox must leave the splash exactly as calm as
                      it always was. */}
                  <div data-testid="start-inbox-panel" className="mx-auto mt-6 w-full max-w-3xl">
                    <InboxPanel
                      variant="wide"
                      hideCapture
                      onOpenProject={(path) => handlers.handleOpenRecent(path)}
                    />
                  </div>
                </div>
              </div>
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
