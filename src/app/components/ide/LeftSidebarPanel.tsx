import { memo, useMemo } from 'react';
import type { useIDEState } from '@/lib/hooks/useIDEState';
import type { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';
import { useStore } from '@/lib/store';
import { extractTicket } from '@/lib/git/branchTicket';
import { repoLabel } from '@/lib/git/repos';
import { FileExplorer } from '../explorer/FileExplorer';
import { SourceControlPanel, type RepoView } from '../git/SourceControlPanel';
import { OutlinePanel } from '../outline/OutlinePanel';
import { ExtensionsPanel } from './ExtensionsPanel';
import { QAPanel } from '../qa/QAPanel';
import { ScratchPanel } from '../scratch/ScratchPanel';
import { NotificationsSidebar } from '../notifications/NotificationsSidebar';
import { InboxPanel } from '../inbox/InboxPanel';
import { AuricIcon } from '../ui/AuricIcon';

const MemoizedFileExplorer = memo(FileExplorer);

type IDEPageState = ReturnType<typeof useIDEState>;
type IDEHandlers = ReturnType<typeof useIDEHandlers>;

interface LeftSidebarPanelProps {
  state: IDEPageState;
  handlers: IDEHandlers;
}

/*
 * The file tree, per-repo git state and the cursor change constantly, so the
 * sections that show them select them here rather than receiving them from
 * the page: a write re-renders the one section, not the IDE around it.
 */

function ExplorerTree({ state, handlers }: LeftSidebarPanelProps) {
  const fileTree = useStore((s) => s.fileTree);
  return (
    <MemoizedFileExplorer
      // Passed straight from the store: FileNode and FileTreeNode are
      // structurally identical, so the deep clone this used to go
      // through bought nothing and handed `memo` a new array on every
      // render — which is every 2s while an agent streams.
      tree={fileTree}
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
  );
}

function SourceControlSection({ state, handlers }: LeftSidebarPanelProps) {
  const repos = useStore((s) => s.repos);
  const repoStates = useStore((s) => s.repoStates);
  const scmView = useStore((s) => s.scmView);
  const historyPath = useStore((s) => s.historyPath);
  const historyCommits = useStore((s) => s.historyCommits);
  const historySelectedOid = useStore((s) => s.historySelectedOid);
  const historyLoading = useStore((s) => s.historyLoading);
  const branches = useStore((s) => s.branches);
  const compareRef = useStore((s) => s.compareRef);
  const compareFiles = useStore((s) => s.compareFiles);
  const compareLoading = useStore((s) => s.compareLoading);
  const branchTicketPattern = state.agentSettings.branchTicketPattern;

  const repoViews = useMemo<RepoView[]>(
    () =>
      // code-gate: complexity-cyclomatic - one ?? default per RepoView field, not branching logic
      repos.map((repo) => {
        const repoState = repoStates[repo.path];
        const branchName = repoState?.branchInfo?.name ?? null;
        return {
          repoPath: repo.path,
          label: repoLabel(repo),
          kind: repo.kind,
          branchName,
          ticketPrefix: extractTicket(branchName ?? '', branchTicketPattern) ?? undefined,
          fileStatuses: (repoState?.fileStatuses ?? []).filter((s) => s.status !== 'ignored'),
          commitMessage: repoState?.commitMessage ?? '',
          isCommitting: repoState?.isCommitting ?? false,
          isPushing: repoState?.isPushing ?? false,
        };
      }),
    [repos, repoStates, branchTicketPattern]
  );

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
      onIgnoreRepo={handlers.handleIgnoreGitRepo}
      onAgenticToggle={(value) => state.updateAgentSettings({ agenticCommit: value })}
      providers={state.providers}
      selectedProviderId={state.agentSettings.commitProviderId || state.defaultProvider.id}
      onProviderChange={(id) => state.updateAgentSettings({ commitProviderId: id })}
      onRefresh={() => handlers.handleRefresh()}
    />
  );
}

function OutlineSection({ state }: { state: IDEPageState }) {
  const cursorLine = useStore((s) => s.cursorPos.line);
  return (
    <OutlinePanel
      content={state.editorContent}
      cursorLine={cursorLine}
      isMarkdown={
        !state.activeTabId ||
        state.activeTabId.endsWith('.md') ||
        state.activeTabId.endsWith('.markdown')
      }
      onHeadingClick={(line) => state.setScrollToLine(line)}
    />
  );
}

export function LeftSidebarPanel({ state, handlers }: LeftSidebarPanelProps) {
  const activeItem = handlers.itemsWithBadge.find((item) => item.id === state.activeActivity);
  // Default activity is explorer. Without a project that destination is
  // gone from the rail — keep the left pane empty rather than a hollow tree.
  if (!activeItem) return null;

  // Every case below must be listed in LEFT_PANEL_ACTIVITIES (lib/ide/leftPanel.ts),
  // or the shell will not give it a column.
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
          <ExplorerTree state={state} handlers={handlers} />
        </div>
      );
    case 'source-control':
      return <SourceControlSection state={state} handlers={handlers} />;
    case 'outline':
      return <OutlineSection state={state} />;
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
}
