'use client';

import { useMemo, memo } from 'react';
import { ActivityBar } from './components/ide/ActivityBar';
import { Header } from './components/ide/Header';
import { IDEShell } from './components/ide/IDEShell';
import { StatusBar } from './components/ide/StatusBar';
import { FileExplorer } from './components/explorer/FileExplorer';
import { TabBar } from './components/editor/TabBar';
import { MarkdownEditor } from './components/editor/MarkdownEditor';
import { ImageViewer } from './components/editor/ImageViewer';
import { SourceControlPanel } from './components/git/SourceControlPanel';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { AgentsPanel } from './components/agents/AgentsPanel';
import { DiffViewer } from './components/editor/DiffViewer';
import { CanvasView } from './components/canvas/CanvasView';
import { MindmapView } from './components/mindmap/MindmapView';
import { IDEOverlays } from './components/ide/IDEOverlays';
import { OutlinePanel } from './components/outline/OutlinePanel';
import { BottomPanelTabs } from './components/ide/BottomPanelTabs';
import { ProblemsPanel } from './components/problems/ProblemsPanel';
import { ExtensionsPanel } from './components/ide/ExtensionsPanel';
import { QAPanel } from './components/qa/QAPanel';
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

export default function Home() {
  const state = useIDEState();
  const handlers = useIDEHandlers(state);
  useIDEActions(state, handlers);

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
      <IDEShell
        bottomCollapsed={state.bottomCollapsed}
        onBottomToggle={state.setBottomCollapsed}
        header={
          <MemoizedHeader
            breadcrumbs={handlers.breadcrumbs}
            headingBreadcrumbs={handlers.headingBreadcrumbs}
            onHeadingBreadcrumbClick={state.setScrollToLine}
            isConnected={state.cliConnected}
            connectionLabel={state.cliConnected ? 'Agentic CLI Connected' : 'Agentic CLI Missing'}
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
            ) : (
              <div className="flex flex-1 items-center justify-center text-center">
                <div className="animate-in fade-in zoom-in duration-700">
                  <h1 className="font-display text-5xl font-black text-white tracking-tighter">
                    AURIC
                    <span className="text-primary-light font-thin tracking-widest ml-2">IDE</span>
                  </h1>
                  <p className="mt-4 text-sm text-foreground-muted uppercase tracking-[0.3em] font-medium opacity-70">
                    AI-native Development
                  </p>
                  <button
                    onClick={handlers.handleOpenFolder}
                    className="mt-10 rounded-xl bg-primary/10 border border-primary/20 px-8 py-3 text-sm font-bold text-primary-light transition-all hover:bg-primary/20 hover:shadow-[0_0_30px_rgba(188,19,254,0.2)]"
                  >
                    Open Project Folder
                  </button>
                  {state.recentProjects.length > 0 && (
                    <div className="mt-8 w-80 mx-auto text-left" data-testid="recent-projects">
                      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted mb-3">
                        Recent Projects
                      </h2>
                      <ul className="space-y-1">
                        {state.recentProjects.map((project) => (
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
                                state.removeRecentProject(project.path);
                              }}
                              title="Remove from recent projects"
                              data-testid={`remove-recent-${project.path}`}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground transition-all mr-1"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </li>
                        ))}
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
