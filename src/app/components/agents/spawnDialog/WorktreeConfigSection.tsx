import { InfoTooltip } from '@/app/components/ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { repoLabel } from '@/lib/git/repos';
import type { GitRepoRef } from '@/lib/tauri/git';
import { SelectChevron } from './SelectChevron';

interface WorktreeConfigSectionProps {
  repoPath: string;
  useWorktree: boolean;
  onUseWorktreeChange: (on: boolean) => void;
  showWorktreePicker: boolean;
  worktreeSources: GitRepoRef[];
  worktreeRepoPath: string;
  onWorktreeRepoChange: (path: string) => void;
  worktreeError: string | null;
}

export function WorktreeConfigSection({
  repoPath,
  useWorktree,
  onUseWorktreeChange,
  showWorktreePicker,
  worktreeSources,
  worktreeRepoPath,
  onWorktreeRepoChange,
  worktreeError,
}: WorktreeConfigSectionProps) {
  return (
    <>
      <label className="flex items-center gap-2 cursor-pointer -mt-1">
        <input
          type="checkbox"
          checked={useWorktree}
          onChange={(e) => onUseWorktreeChange(e.target.checked)}
          disabled={!repoPath}
          className="accent-primary h-3.5 w-3.5"
        />
        <span className="flex items-center text-xs text-foreground-muted">
          New git worktree
          <InfoTooltip description={GUIDANCE.agents.worktree} label="i" />
          <span className="text-[10px] ml-1 opacity-60">
            Isolated branch, leaves your checkout alone
          </span>
        </span>
      </label>

      {showWorktreePicker && (
        <div className="space-y-1.5 -mt-1">
          <label
            htmlFor="worktree-repo"
            className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
          >
            Git repository
            <InfoTooltip description={GUIDANCE.agents.worktreeRepo} label="i" />
          </label>
          <div className="relative">
            <select
              id="worktree-repo"
              value={worktreeRepoPath}
              onChange={(e) => onWorktreeRepoChange(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
            >
              <option value="">Choose a repository…</option>
              {worktreeSources.map((source) => (
                <option key={source.path} value={source.path}>
                  {repoLabel(source)}
                  {source.kind === 'submodule' ? ' (submodule)' : ''}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>
      )}

      {worktreeError && (
        <p role="alert" className="text-[11px] text-red-400 -mt-2">
          {worktreeError}
        </p>
      )}
    </>
  );
}
