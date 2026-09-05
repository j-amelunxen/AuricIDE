import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { RepoBody } from './RepoBody';
import type { DiffSide, RepoView } from './types';

export interface RepoSectionProps {
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
export function RepoSection({
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
