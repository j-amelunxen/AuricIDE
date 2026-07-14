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
import { ContextMenu, type ContextMenuOption } from './components/ide/ContextMenu';
import { MissionControl } from './components/cockpit/MissionControl';
import { ExcalidrawViewer } from './components/excalidraw/ExcalidrawViewer';
import { ExcalidrawBrowser } from './components/excalidraw/ExcalidrawBrowser';
import { OBSIDIAN_COLORS } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianColor, ObsidianNode } from '@/lib/obsidian-canvas/types';
import { TicketCreateModal } from './components/pm/TicketCreateModal';
import { RequirementsModal } from './components/requirements/RequirementsModal';
import { GoalsModal } from './components/goals/GoalsModal';
import { OrchestrationModal } from './components/goals/OrchestrationModal';
import { NewProjectModal, type NewProjectOptions } from './components/ide/NewProjectModal';
import { extractTicket } from '@/lib/git/branchTicket';
import { useIDEState } from '@/lib/hooks/useIDEState';
import { useIDEActions } from '@/lib/hooks/useIDEActions';
import { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';

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

export default function Home() {
  const state = useIDEState();
  const handlers = useIDEHandlers(state);
  useIDEActions(state, handlers);

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
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
              )}
            </div>
            <MemoizedFileExplorer
              tree={handlers.toFileTreeNodes(state.fileTree)}
              selectedPath={state.selectedPath}
              onSelectFile={handlers.handleFileSelect}
              onToggleDir={handlers.handleToggleDir}
              onNewFile={handlers.handleNewFile}
              onRefresh={handlers.handleRefresh}
              onOpenFolder={handlers.handleOpenFolder}
              onContextMenu={handlers.handleContextMenu}
              onMoveNode={handlers.handleMoveNode}
              rootPath={state.rootPath}
            />
          </div>
        );
      case 'source-control':
        return (
          <SourceControlPanel
            fileStatuses={state.fileStatuses.filter((s) => s.status !== 'ignored')}
            commitMessage={state.commitMessage}
            isCommitting={state.isCommitting}
            agenticCommit={state.agentSettings.agenticCommit}
            ticketPrefix={
              extractTicket(
                state.branchInfo?.name ?? '',
                state.agentSettings.branchTicketPattern
              ) ?? undefined
            }
            onCommitMessageChange={state.setCommitMessage}
            onCommit={handlers.handleCommit}
            onStageFile={(path) => state.rootPath && state.stageFile(state.rootPath, path)}
            onUnstageFile={(path) => state.rootPath && state.unstageFile(state.rootPath, path)}
            onFileClick={handlers.handleDiffFileClick}
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
      default:
        return null;
    }
  }, [state, handlers]);

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
      <RequirementsModal />
      <ExcalidrawBrowser
        onImported={() => void handlers.handleRefresh()}
        onOpenSettings={() => state.setSettingsModalOpen(true)}
      />
      <GoalsModal />
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
            connectionLabel={state.cliConnected ? 'CLI connected' : 'CLI not detected'}
            llmConfigured={state.llmConfigured}
            onCommandPalette={() => state.setCommandPaletteOpen(true)}
          />
        }
        activityBar={
          <MemoizedActivityBar
            items={handlers.itemsWithBadge}
            activeId={state.activeActivity}
            onSelect={handlers.handleActivitySelect}
            onTerminalToggle={() => state.setBottomCollapsed(!state.bottomCollapsed)}
            onAgentsToggle={() => state.setRightCollapsed(!state.rightCollapsed)}
          />
        }
        leftPanel={leftPanelContent}
        centerContent={
          <div className="flex h-full flex-col">
            <MemoizedTabBar
              tabs={state.openTabs}
              activeTabId={state.activeTabId}
              onSelect={state.setActiveTab}
              onClose={state.closeTab}
              onCloseOthers={state.closeOtherTabs}
              onCloseAll={state.closeAllTabs}
              onCloseToRight={state.closeTabsToRight}
            />
            {state.activeTabId ? (
              <div className="flex-1 overflow-hidden">
                {handlers.isDiffTab && state.diffContent !== null ? (
                  <DiffViewer diff={state.diffContent} fileName={handlers.diffFilePath ?? ''} />
                ) : state.imageData ? (
                  <ImageViewer
                    src={state.imageData}
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
                  onSwitchProject={(path) => handlers.handleOpenRecent(path)}
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-center">
                <div className="animate-in fade-in zoom-in duration-700">
                  <h1 className="font-display text-5xl font-black text-white tracking-tighter">
                    AURIC
                    <span className="text-primary-light font-thin tracking-widest ml-2">IDE</span>
                  </h1>
                  <p className="mt-4 text-sm text-foreground-muted uppercase tracking-[0.3em] font-medium">
                    AI-native Development
                  </p>
                  <div className="mt-10 flex items-center justify-center gap-3">
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
                      <span className="material-symbols-outlined text-[18px]">add</span>
                      New
                    </button>
                  </div>
                  {state.recentProjects.length > 0 && (
                    <div className="mt-8 w-80 mx-auto text-left" data-testid="recent-projects">
                      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted mb-3">
                        Recent Projects
                      </h2>
                      <ul className="space-y-1">
                        {state.recentProjects.map((project) => {
                          const isStarred = state.starredProjects.some(
                            (s) => s.path === project.path
                          );
                          return (
                            <li key={project.path} className="group flex items-center">
                              <button
                                onClick={() => handlers.handleOpenRecent(project.path)}
                                className="flex-1 flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/5"
                              >
                                <span className="material-symbols-outlined text-primary-light text-base">
                                  folder
                                </span>
                                <span className="text-sm font-medium text-foreground truncate">
                                  {project.name}
                                </span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  state.toggleStarredProject(project.path);
                                }}
                                title={
                                  isStarred
                                    ? 'Unstar — remove from Quick Access'
                                    : 'Star for Quick Access'
                                }
                                data-testid={`star-recent-${project.path}`}
                                className={`p-1 rounded transition-all mr-0.5 ${
                                  isStarred
                                    ? 'text-primary-light opacity-100'
                                    : 'opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-foreground hover:bg-white/10'
                                }`}
                              >
                                <span
                                  className="material-symbols-outlined text-[14px]"
                                  style={
                                    isStarred ? { fontVariationSettings: "'FILL' 1" } : undefined
                                  }
                                >
                                  star
                                </span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  state.removeRecentProject(project.path);
                                }}
                                title="Remove from recent projects"
                                data-testid={`remove-recent-${project.path}`}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground transition-all mr-1"
                              >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div className="mt-10 w-80 mx-auto text-left" data-testid="tip-of-the-day">
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted mb-3">
                      Tip of the Day
                    </h2>
                    <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/10 px-4 py-3">
                      <span className="material-symbols-outlined text-primary-light text-base mt-0.5">
                        {handlers.dailyTip.icon}
                      </span>
                      <p className="text-[12px] text-foreground-muted leading-relaxed">
                        {handlers.dailyTip.text}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        }
        rightPanel={
          <MemoizedAgentsPanel
            agents={state.agents}
            onSpawn={() => state.setSpawnDialogOpen(true)}
            onKill={handlers.handleKillAgent}
            onKillRepo={state.killAgentsForRepoPath}
            onSelectAgent={handlers.handleSelectAgent}
            onImageDrop={handlers.handleImageDrop}
            onCollapse={() => state.setRightCollapsed(true)}
          />
        }
        bottomPanel={
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
        }
        statusBar={
          <MemoizedStatusBar
            branch={state.branchInfo?.name ?? 'main'}
            encoding="UTF-8"
            language={handlers.activeLanguage}
            cursorPos={state.cursorPos}
            errorCount={handlers.activeDiagCounts.errors}
            warningCount={handlers.activeDiagCounts.warnings}
            onProblemsClick={handlers.handleProblemsClick}
          />
        }
      />
    </>
  );
}
