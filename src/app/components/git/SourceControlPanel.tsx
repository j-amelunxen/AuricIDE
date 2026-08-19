'use client';

import { useState, type MouseEvent } from 'react';
import { ContextMenu } from '../ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { isStaged, isUnstagedTracked, isUntracked } from '@/lib/git/statusSplit';
import type {
  CommitInfo,
  GitBranch,
  GitFileStatus,
  GitNameStatus,
  GitRepoKind,
} from '@/lib/tauri/git';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { ScmView } from '@/lib/store/gitSlice';
import { HistoryView } from './HistoryView';
import { CompareView } from './CompareView';
import { AgentWorktreesPanel } from './AgentWorktreesPanel';

type DiffSide = 'staged' | 'unstaged';

export interface RepoView {
  repoPath: string;
  label: string;
  kind: GitRepoKind;
  branchName: string | null;
  ticketPrefix?: string;
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  isPushing: boolean;
}

export interface SourceControlProps {
  repos: RepoView[];
  agenticCommit?: boolean;
  providers?: ProviderInfo[];
  selectedProviderId?: string;
  onCommitMessageChange: (repoPath: string, msg: string) => void;
  onCommit: (repoPath: string, options?: { push?: boolean }) => void;
  onStageFile: (repoPath: string, path: string) => void;
  onUnstageFile: (repoPath: string, path: string) => void;
  onStageAll?: (repoPath: string) => void;
  onUnstageAll?: (repoPath: string) => void;
  /** Pushes the given repo's current branch to origin. Omit to hide the button. */
  onPush?: (repoPath: string) => void;
  onFileClick?: (repoPath: string, path: string, side: DiffSide) => void;
  onDiscardFile?: (repoPath: string, path: string) => void;
  onAgenticToggle?: (value: boolean) => void;
  onProviderChange?: (id: string) => void;
  onRefresh?: () => void;
  scmView?: ScmView;
  onScmViewChange?: (view: ScmView) => void;
  /** History / Compare target when more than one repo is open. */
  activeRepoPath?: string | null;
  onActiveRepoChange?: (repoPath: string) => void;
  historyPath?: string | null;
  historyCommits?: CommitInfo[];
  historySelectedOid?: string | null;
  historyLoading?: boolean;
  onHistoryCommitClick?: (oid: string) => void;
  branches?: GitBranch[];
  compareRef?: string | null;
  compareFiles?: GitNameStatus[];
  compareLoading?: boolean;
  onCompareRefChange?: (ref: string) => void;
  onCompareFileClick?: (path: string) => void;
  /** Hide a nested repo from discovery and the dirty probe. Omit for the root. */
  onIgnoreRepo?: (repoPath: string) => void;
}

const statusBadge: Record<string, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-git-added' },
  modified: { label: 'M', className: 'text-git-modified' },
  deleted: { label: 'D', className: 'text-git-deleted' },
  untracked: { label: 'U', className: 'text-foreground-muted' },
};

type RowAction = 'stage' | 'unstage';

function badgeFor(file: GitFileStatus, side: DiffSide) {
  const kind = side === 'staged' ? file.staged : file.unstaged;
  return (kind && statusBadge[kind]) || statusBadge[file.status] || statusBadge.untracked;
}

function FileRow({
  file,
  side,
  actionKind,
  onAction,
  onFileClick,
  onContextMenu,
}: {
  file: GitFileStatus;
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onContextMenu?: (e: MouseEvent, file: GitFileStatus) => void;
}) {
  const badge = badgeFor(file, side);
  return (
    <div
      className="flex items-center gap-1 pr-2 text-xs text-foreground-muted hover:bg-primary/5"
      onContextMenu={(e) => onContextMenu?.(e, file)}
    >
      <div
        role={onFileClick ? 'button' : undefined}
        tabIndex={onFileClick ? 0 : undefined}
        onClick={() => onFileClick?.(file.path, side)}
        onKeyDown={(e) => {
          if (onFileClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onFileClick(file.path, side);
          }
        }}
        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1 ${onFileClick ? 'cursor-pointer' : ''}`}
      >
        <AuricIcon name="description" className="text-sm" />
        <span className={`flex-1 truncate ${badge.className}`}>{file.path}</span>
        <span className={`text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
      </div>
      <button
        type="button"
        data-testid={`${actionKind}-${file.path}`}
        aria-label={actionKind === 'stage' ? 'Stage' : 'Unstage'}
        onClick={(e) => {
          e.stopPropagation();
          onAction(file.path);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-primary/10 hover:text-primary"
      >
        {actionKind === 'stage' ? '+' : '−'}
      </button>
    </div>
  );
}

function FileList({
  files,
  side,
  actionKind,
  onAction,
  onFileClick,
  onDiscardFile,
}: {
  files: GitFileStatus[];
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  );

  // Asked in-app and awaited. The browser's confirm() does not suspend the
  // script inside the Tauri webview, so the file would already be gone by the
  // time the user reads the question.
  const { confirm, confirmDialog } = useConfirm();

  /**
   * Discard is the only action here git cannot take back, and its menu item
   * appears directly under the cursor after a right-click. What it costs
   * depends on whether git has a copy: for a file that was never committed
   * there is nothing behind it, so discarding is a plain deletion — say that
   * instead of the softer "changes are lost".
   */
  const confirmDiscard = async (file: GitFileStatus) => {
    const neverCommitted = file.status === 'untracked' || file.status === 'added';
    const go = await confirm(
      neverCommitted
        ? {
            title: 'Delete this file?',
            message: `${file.path} has never been committed, so git has no copy of it. Discarding deletes it from disk and it cannot be recovered.`,
            confirmLabel: 'Delete',
          }
        : {
            title: 'Discard changes?',
            message: `Discard your changes to ${file.path}? It is restored to the last commit and the uncommitted changes are gone for good.`,
            confirmLabel: 'Discard',
          }
    );
    if (!go) return;
    onDiscardFile?.(file.path);
  };

  const allowDiscard = (file: GitFileStatus) => {
    if (!onDiscardFile) return false;
    // Changes + Untracked always; Staged only when the file is not also in Changes.
    if (side === 'unstaged') return true;
    return !isUnstagedTracked(file);
  };

  return (
    <div>
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          side={side}
          actionKind={actionKind}
          onAction={onAction}
          onFileClick={onFileClick}
          onContextMenu={
            allowDiscard(file)
              ? (e, target) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, path: target.path });
                }
              : undefined
          }
        />
      ))}
      {contextMenu && onDiscardFile && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={[
            {
              label: 'Discard Changes',
              icon: 'undo',
              danger: true,
              action: () => {
                const file = files.find((f) => f.path === contextMenu.path);
                if (file) void confirmDiscard(file);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

function FileSection({
  title,
  testId,
  files,
  side,
  actionKind,
  onAction,
  headerAction,
  bordered,
  onFileClick,
  onDiscardFile,
}: {
  title: string;
  testId: string;
  files: GitFileStatus[];
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  headerAction?: { label: string; onClick: () => void };
  bordered?: boolean;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
}) {
  return (
    <div data-testid={testId} className={bordered ? 'border-t border-border-dark' : undefined}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          {title} ({files.length})
        </h3>
        {headerAction && (
          <button
            type="button"
            onClick={headerAction.onClick}
            className="text-[10px] font-medium text-foreground-muted hover:text-primary"
          >
            {headerAction.label}
          </button>
        )}
      </div>
      <FileList
        files={files}
        side={side}
        actionKind={actionKind}
        onAction={onAction}
        onFileClick={onFileClick}
        onDiscardFile={onDiscardFile}
      />
    </div>
  );
}

function AgenticControls({
  agenticCommit,
  providers,
  selectedProviderId,
  onAgenticToggle,
  onProviderChange,
}: {
  agenticCommit: boolean;
  providers: ProviderInfo[];
  selectedProviderId?: string;
  onAgenticToggle?: (value: boolean) => void;
  onProviderChange?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={agenticCommit}
          onChange={(e) => onAgenticToggle?.(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        <span className="text-xs text-foreground-muted">Agentic</span>
      </label>

      {agenticCommit && providers.length > 0 && (
        <select
          value={selectedProviderId}
          onChange={(e) => onProviderChange?.(e.target.value)}
          className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground-muted outline-none focus:border-primary"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

interface RepoBodyProps {
  repo: RepoView;
  agenticCommit: boolean;
  renderAgenticControls: boolean;
  providers: ProviderInfo[];
  selectedProviderId?: string;
  onAgenticToggle?: (value: boolean) => void;
  onProviderChange?: (id: string) => void;
  onCommitMessageChange: (msg: string) => void;
  onCommit: (options?: { push?: boolean }) => void;
  onPush?: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
}

/** The commit box plus the Staged/Changes/Untracked lists for one repo. */
function RepoBody({
  repo,
  agenticCommit,
  renderAgenticControls,
  providers,
  selectedProviderId,
  onAgenticToggle,
  onProviderChange,
  onCommitMessageChange,
  onCommit,
  onPush,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onFileClick,
  onDiscardFile,
}: RepoBodyProps) {
  const visible = repo.fileStatuses.filter((s) => s.status !== 'ignored');
  const staged = visible.filter(isStaged);
  const changed = visible.filter(isUnstagedTracked);
  const untracked = visible.filter(isUntracked);
  const hasChanges = staged.length + changed.length + untracked.length > 0;
  const pushButton = onPush ? (
    <button
      type="button"
      onClick={onPush}
      disabled={repo.isPushing}
      title="Push the current branch to origin"
      className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/20 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
    >
      {repo.isPushing ? 'Pushing...' : 'Push'}
    </button>
  ) : null;

  return (
    <>
      <div className="px-3 pb-3">
        {repo.ticketPrefix && (
          <div
            data-testid="ticket-badge"
            className="mb-2 inline-flex items-center gap-1.5 rounded bg-primary/10 border border-primary/20 px-2 py-0.5"
          >
            <AuricIcon name="confirmation_number" className="text-primary-light text-xs" />
            <span className="text-[11px] font-mono font-bold text-primary-light">
              {repo.ticketPrefix}
            </span>
          </div>
        )}
        <textarea
          placeholder="Commit message"
          value={repo.commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          className="w-full resize-none rounded border border-border-dark bg-editor-bg px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
          rows={3}
        />
        {renderAgenticControls && (
          <div className="mt-2">
            <AgenticControls
              agenticCommit={agenticCommit}
              providers={providers}
              selectedProviderId={selectedProviderId}
              onAgenticToggle={onAgenticToggle}
              onProviderChange={onProviderChange}
            />
          </div>
        )}
        {/* Commit stays local. Commit & Push publishes. In agentic mode both
        are one click each; the agent prompt is the same, the last sentence
        is not. Push of already-committed work stays its own button. */}
        <div className="mt-2 flex flex-col gap-2">
          {agenticCommit && repo.isCommitting ? (
            <button
              type="button"
              disabled
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white opacity-50 cursor-not-allowed"
            >
              Running Agent...
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onCommit()}
                disabled={
                  agenticCommit
                    ? repo.isCommitting
                    : !repo.commitMessage.trim() || repo.isCommitting
                }
                title={agenticCommit ? 'Agent writes the commit. Stays local.' : undefined}
                className="flex-1 whitespace-nowrap rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {repo.isCommitting ? 'Committing...' : 'Commit'}
              </button>
              {agenticCommit && (
                <button
                  type="button"
                  onClick={() => onCommit({ push: true })}
                  disabled={repo.isCommitting}
                  title="Agent writes the commit and pushes to origin."
                  className="flex-1 whitespace-nowrap rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition-[transform,background-color,opacity] duration-100 ease-out hover:bg-primary/90 active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  Commit & Push
                </button>
              )}
              {!agenticCommit && pushButton}
            </div>
          )}
          {agenticCommit && pushButton}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto border-t border-border-dark">
        {!hasChanges ? (
          <p className="p-3 text-xs text-foreground-muted">No changes</p>
        ) : (
          <>
            {staged.length > 0 && (
              <FileSection
                title="Staged"
                testId="staged-files"
                files={staged}
                side="staged"
                actionKind="unstage"
                onAction={onUnstageFile}
                headerAction={
                  onUnstageAll ? { label: 'Unstage All', onClick: onUnstageAll } : undefined
                }
                onFileClick={onFileClick}
                onDiscardFile={onDiscardFile}
              />
            )}
            {changed.length > 0 && (
              <FileSection
                title="Changes"
                testId="changed-files"
                files={changed}
                side="unstaged"
                actionKind="stage"
                onAction={onStageFile}
                headerAction={onStageAll ? { label: 'Stage All', onClick: onStageAll } : undefined}
                bordered={staged.length > 0}
                onFileClick={onFileClick}
                onDiscardFile={onDiscardFile}
              />
            )}
            {untracked.length > 0 && (
              <FileSection
                title="Untracked"
                testId="untracked-files"
                files={untracked}
                side="unstaged"
                actionKind="stage"
                onAction={onStageFile}
                bordered={staged.length > 0 || changed.length > 0}
                onFileClick={onFileClick}
                onDiscardFile={onDiscardFile}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

interface RepoSectionProps {
  repo: RepoView;
  agenticCommit: boolean;
  onCommitMessageChange: (msg: string) => void;
  onCommit: (options?: { push?: boolean }) => void;
  onPush?: () => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
  onIgnoreRepo?: (repoPath: string) => void;
}

/** One collapsible repo in the multi-repo Changes view. */
function RepoSection({
  repo,
  agenticCommit,
  onCommitMessageChange,
  onCommit,
  onPush,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onFileClick,
  onDiscardFile,
  onIgnoreRepo,
}: RepoSectionProps) {
  const changeCount = repo.fileStatuses.filter((s) => s.status !== 'ignored').length;
  // Repos mount before their statuses arrive, so the initial changeCount is
  // often 0 for a repo that does have changes. A section follows its content
  // until the user makes an explicit choice, which then sticks regardless of
  // what arrives afterward.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? changeCount > 0;
  const canIgnore = repo.kind !== 'root' && !!onIgnoreRepo;

  return (
    <div
      data-testid={`repo-section-${repo.repoPath}`}
      className="border-t border-border-dark first:border-t-0"
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setUserExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <AuricIcon
              name={expanded ? 'expand_more' : 'chevron_right'}
              className="shrink-0 text-sm text-foreground-muted"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              {repo.label}
            </span>
            {repo.kind === 'submodule' && (
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary-light">
                Submodule
              </span>
            )}
            {repo.branchName && (
              <span className="max-w-[40%] shrink-0 truncate text-[10px] text-foreground-muted">
                {repo.branchName}
              </span>
            )}
          </span>
          <span
            className="shrink-0 text-[10px] font-medium text-foreground-muted"
            aria-label={`${changeCount} changed file${changeCount === 1 ? '' : 's'}`}
          >
            {changeCount}
          </span>
        </button>
        {canIgnore && (
          <button
            type="button"
            data-testid={`ignore-repo-${repo.repoPath}`}
            aria-label="Ignore this repository"
            title="Hide this repository from Source Control and Quick Access"
            onClick={() => onIgnoreRepo?.(repo.repoPath)}
            className="mr-2 shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            Ignore
          </button>
        )}
      </div>
      {expanded && (
        <RepoBody
          repo={repo}
          agenticCommit={agenticCommit}
          renderAgenticControls={false}
          providers={[]}
          onCommitMessageChange={onCommitMessageChange}
          onCommit={onCommit}
          onPush={onPush}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onStageAll={onStageAll}
          onUnstageAll={onUnstageAll}
          onFileClick={onFileClick}
          onDiscardFile={onDiscardFile}
        />
      )}
    </div>
  );
}

function RepoPicker({
  repos,
  activeRepoPath,
  onChange,
}: {
  repos: RepoView[];
  activeRepoPath: string | null;
  onChange?: (repoPath: string) => void;
}) {
  return (
    <div className="px-3 pb-2">
      <select
        data-testid="scm-repo-picker"
        aria-label="Repository"
        value={activeRepoPath ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
      >
        {repos.map((repo) => (
          <option key={repo.repoPath} value={repo.repoPath}>
            {repo.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
