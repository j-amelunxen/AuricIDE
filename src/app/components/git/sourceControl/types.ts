import type {
  CommitInfo,
  GitBranch,
  GitFileStatus,
  GitNameStatus,
  GitRepoKind,
} from '@/lib/tauri/git';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { ScmView } from '@/lib/store/gitSlice';

export type DiffSide = 'staged' | 'unstaged';

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

export const statusBadge: Record<string, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-git-added' },
  modified: { label: 'M', className: 'text-git-modified' },
  deleted: { label: 'D', className: 'text-git-deleted' },
  untracked: { label: 'U', className: 'text-foreground-muted' },
};

export type RowAction = 'stage' | 'unstage';

export function badgeFor(file: GitFileStatus, side: DiffSide) {
  const kind = side === 'staged' ? file.staged : file.unstaged;
  return (kind && statusBadge[kind]) || statusBadge[file.status] || statusBadge.untracked;
}
