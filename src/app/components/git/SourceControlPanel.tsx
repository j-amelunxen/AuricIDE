'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { HistoryView } from './HistoryView';
import { CompareView } from './CompareView';
import { AgentWorktreesPanel } from './AgentWorktreesPanel';
import type { RepoView, SourceControlProps } from './sourceControl/types';
import { AgenticControls } from './sourceControl/AgenticControls';
import { RepoBody } from './sourceControl/RepoBody';
import { RepoSection } from './sourceControl/RepoSection';
import { RepoPicker } from './sourceControl/RepoPicker';

export type { RepoView, SourceControlProps };

export function SourceControlPanel({
  repos,
  agenticCommit = false,
  providers = [],
  selectedProviderId,
  onCommitMessageChange,
  onCommit,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onPush,
  onFileClick,
  onDiscardFile,
  onAgenticToggle,
  onProviderChange,
  onRefresh,
  scmView = 'changes',
  onScmViewChange,
  activeRepoPath = null,
  onActiveRepoChange,
  historyPath = null,
  historyCommits = [],
  historySelectedOid = null,
  historyLoading = false,
  onHistoryCommitClick,
  branches = [],
  compareRef = null,
  compareFiles = [],
  compareLoading = false,
  onCompareRefChange,
  onCompareFileClick,
  onIgnoreRepo,
}: SourceControlProps) {
  const isSingleRoot = repos.length === 1 && repos[0].kind === 'root';

  return (
    <div data-testid="source-control-panel" className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Source Control
        </h2>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh"
            className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <AuricIcon name="refresh" className="text-sm" />
          </button>
        )}
      </div>

      <div className="flex gap-1 px-3 pb-2">
        {(
          [
            ['changes', 'Changes', 'scm-view-changes'],
            ['history', 'History', 'scm-view-history'],
            ['compare', 'Compare', 'scm-view-compare'],
          ] as const
        ).map(([view, label, testId]) => (
          <button
            key={view}
            type="button"
            data-testid={testId}
            onClick={() => onScmViewChange?.(view)}
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              scmView === view
                ? 'bg-primary/15 text-primary-light'
                : 'text-foreground-muted hover:bg-primary/5 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {scmView === 'history' && (
        <>
          {repos.length > 1 && (
            <RepoPicker
              repos={repos}
              activeRepoPath={activeRepoPath}
              onChange={onActiveRepoChange}
            />
          )}
          <HistoryView
            historyPath={historyPath}
            commits={historyCommits}
            selectedOid={historySelectedOid}
            loading={historyLoading}
            onCommitClick={onHistoryCommitClick}
          />
        </>
      )}

      {scmView === 'compare' && (
        <>
          {repos.length > 1 && (
            <RepoPicker
              repos={repos}
              activeRepoPath={activeRepoPath}
              onChange={onActiveRepoChange}
            />
          )}
          <CompareView
            branches={branches}
            compareRef={compareRef}
            files={compareFiles}
            loading={compareLoading}
            onRefChange={onCompareRefChange}
            onFileClick={onCompareFileClick}
          />
        </>
      )}

      {scmView === 'changes' &&
        (repos.length === 0 ? (
          <div className="flex-1 px-3 py-3">
            <p className="text-xs text-foreground-muted">
              No git repository found in this folder or up to 4 levels below it.
            </p>
          </div>
        ) : isSingleRoot ? (
          <RepoBody
            repo={repos[0]}
            agenticCommit={agenticCommit}
            renderAgenticControls
            providers={providers}
            selectedProviderId={selectedProviderId}
            onAgenticToggle={onAgenticToggle}
            onProviderChange={onProviderChange}
            onCommitMessageChange={(msg) => onCommitMessageChange(repos[0].repoPath, msg)}
            onCommit={(opts) =>
              opts?.push ? onCommit(repos[0].repoPath, { push: true }) : onCommit(repos[0].repoPath)
            }
            onPush={onPush ? () => onPush(repos[0].repoPath) : undefined}
            onStageFile={(path) => onStageFile(repos[0].repoPath, path)}
            onUnstageFile={(path) => onUnstageFile(repos[0].repoPath, path)}
            onStageAll={onStageAll ? () => onStageAll(repos[0].repoPath) : undefined}
            onUnstageAll={onUnstageAll ? () => onUnstageAll(repos[0].repoPath) : undefined}
            onFileClick={
              onFileClick ? (path, side) => onFileClick(repos[0].repoPath, path, side) : undefined
            }
            onDiscardFile={
              onDiscardFile ? (path) => onDiscardFile(repos[0].repoPath, path) : undefined
            }
          />
        ) : (
          <>
            <div className="px-3 pb-3">
              <AgenticControls
                agenticCommit={agenticCommit}
                providers={providers}
                selectedProviderId={selectedProviderId}
                onAgenticToggle={onAgenticToggle}
                onProviderChange={onProviderChange}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {repos.map((repo) => (
                <RepoSection
                  key={repo.repoPath}
                  repo={repo}
                  agenticCommit={agenticCommit}
                  onCommitMessageChange={(msg) => onCommitMessageChange(repo.repoPath, msg)}
                  onCommit={(opts) =>
                    opts?.push ? onCommit(repo.repoPath, { push: true }) : onCommit(repo.repoPath)
                  }
                  onPush={onPush ? () => onPush(repo.repoPath) : undefined}
                  onStageFile={(path) => onStageFile(repo.repoPath, path)}
                  onUnstageFile={(path) => onUnstageFile(repo.repoPath, path)}
                  onStageAll={onStageAll ? () => onStageAll(repo.repoPath) : undefined}
                  onUnstageAll={onUnstageAll ? () => onUnstageAll(repo.repoPath) : undefined}
                  onFileClick={
                    onFileClick ? (path, side) => onFileClick(repo.repoPath, path, side) : undefined
                  }
                  onDiscardFile={
                    onDiscardFile ? (path) => onDiscardFile(repo.repoPath, path) : undefined
                  }
                  onIgnoreRepo={onIgnoreRepo}
                />
              ))}
            </div>
          </>
        ))}
      {scmView === 'changes' && <AgentWorktreesPanel />}
    </div>
  );
}
