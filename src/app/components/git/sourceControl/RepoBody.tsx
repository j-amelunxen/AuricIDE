import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { isStaged, isUnstagedTracked, isUntracked } from '@/lib/git/statusSplit';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { AgenticControls } from './AgenticControls';
import { FileSection } from './FileSection';
import type { DiffSide, RepoView } from './types';

export interface RepoBodyProps {
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
export function RepoBody({
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
