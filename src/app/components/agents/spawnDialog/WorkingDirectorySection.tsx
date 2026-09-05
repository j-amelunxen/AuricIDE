import { InfoTooltip } from '@/app/components/ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { SelectChevron } from './SelectChevron';

interface WorkingDirectorySectionProps {
  repoPath: string;
  onRepoPathChange: (next: string) => void;
  onBrowse: () => void;
  recentPaths: string[];
  sortedQuickAccess: StarredProject[];
  selectedPaths: string[];
  allPinnedSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleQuickAccess: (path: string) => void;
}

export function WorkingDirectorySection({
  repoPath,
  onRepoPathChange,
  onBrowse,
  recentPaths,
  sortedQuickAccess,
  selectedPaths,
  allPinnedSelected,
  onToggleSelectAll,
  onToggleQuickAccess,
}: WorkingDirectorySectionProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor="repo-path"
        className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
      >
        Working Directory
        <InfoTooltip description={GUIDANCE.pm.workingDirectory} label="i" />
      </label>
      <div className="flex gap-2">
        <input
          id="repo-path"
          type="text"
          value={repoPath}
          onChange={(e) => onRepoPathChange(e.target.value)}
          className="flex-1 rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
          placeholder="/path/to/repo"
        />
        <button
          type="button"
          onClick={onBrowse}
          className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
        >
          Browse
        </button>
      </div>
      {recentPaths.length > 0 && (
        <div className="relative">
          <select
            data-testid="recent-dirs"
            value=""
            onChange={(e) => {
              if (e.target.value) onRepoPathChange(e.target.value);
            }}
            className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground-muted outline-none focus:border-primary/50 transition-colors appearance-none"
          >
            <option value="">Recent directories...</option>
            {recentPaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <SelectChevron />
        </div>
      )}
      {sortedQuickAccess.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Quick Access
            </p>
            {selectedPaths.length > 1 && (
              <span className="tabular-nums text-[10px] text-foreground-muted/70">
                {selectedPaths.length} selected
              </span>
            )}
            {sortedQuickAccess.length >= 2 && (
              <button
                type="button"
                data-testid="spawn-select-all"
                onClick={onToggleSelectAll}
                className="-mr-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary/80 transition-[color,transform] hover:text-primary active:scale-[0.96]"
              >
                {allPinnedSelected ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          <div
            data-testid="spawn-quick-access"
            role="group"
            aria-label="Quick Access projects"
            className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto"
          >
            {sortedQuickAccess.map((project) => {
              const selected = selectedPaths.includes(project.path);
              return (
                <button
                  key={project.path}
                  type="button"
                  aria-pressed={selected}
                  aria-label={project.name}
                  onClick={() => onToggleQuickAccess(project.path)}
                  className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] transition-[color,background-color,box-shadow,transform] active:scale-[0.96] ${
                    selected
                      ? 'bg-primary/15 text-foreground ring-1 ring-primary/50'
                      : 'bg-white/5 text-foreground-muted hover:bg-white/10 hover:text-foreground'
                  }`}
                >
                  <ProjectTileFace
                    path={project.path}
                    icon={project.icon}
                    size="xs"
                    className="flex-shrink-0"
                  />
                  <span className="max-w-[7rem] truncate">{project.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
