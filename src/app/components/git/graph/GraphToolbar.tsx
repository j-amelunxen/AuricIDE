import { useRef } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { Point } from './GraphRowItem';

export interface GraphToolbarProps {
  repos: Array<{ path: string; name: string }>;
  repoPath: string;
  onRepoChange: (path: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  /** Zero-based position of the current match, or -1 before stepping. */
  matchIndex: number;
  onStepMatch: (direction: 1 | -1) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  branchFilterLabel: string;
  onOpenBranchFilter: (point: Point) => void;
  onJumpToHead: () => void;
  jumpDisabledReason: string | undefined;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

const BUTTON =
  'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground-muted transition-[background-color,color,transform] duration-100 ease-out hover:bg-white/10 hover:text-foreground active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100';
const ICON_BUTTON = `${BUTTON} w-7 justify-center px-0`;

function matchSummary(count: number, index: number): string {
  if (count === 0) return 'No matches';
  return index < 0 ? `${count} ${count === 1 ? 'match' : 'matches'}` : `${index + 1} of ${count}`;
}

export function GraphToolbar({
  repos,
  repoPath,
  onRepoChange,
  query,
  onQueryChange,
  matchCount,
  matchIndex,
  onStepMatch,
  searchRef,
  branchFilterLabel,
  onOpenBranchFilter,
  onJumpToHead,
  jumpDisabledReason,
  inspectorOpen,
  onToggleInspector,
}: GraphToolbarProps) {
  const branchButton = useRef<HTMLButtonElement>(null);
  const searching = query.trim().length > 0;
  return (
    <div
      role="group"
      aria-label="Graph"
      className="flex items-center gap-2 border-b border-white/5 px-3 py-2"
    >
      {repos.length > 1 && (
        <select
          aria-label="Repository"
          value={repoPath}
          onChange={(e) => onRepoChange(e.target.value)}
          className="h-7 max-w-40 rounded-md border border-border-dark bg-editor-bg px-2 text-xs text-foreground"
        >
          {repos.map((repo) => (
            <option key={repo.path} value={repo.path}>
              {repo.name}
            </option>
          ))}
        </select>
      )}

      <div className="relative flex min-w-0 max-w-sm flex-1 items-center">
        <AuricIcon
          name="search"
          aria-hidden="true"
          className="pointer-events-none absolute left-2 text-sm text-foreground-muted"
        />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search commits"
          placeholder="Search commits"
          value={query}
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-7 w-full rounded-md border border-border-dark bg-editor-bg pl-7 pr-7 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {searching && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-0.5 flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:text-foreground"
            onClick={() => onQueryChange('')}
          >
            <AuricIcon name="close" aria-hidden="true" className="text-xs" />
          </button>
        )}
      </div>

      {searching && (
        <div className="flex items-center gap-0.5">
          <span className="px-1 text-[11px] tabular-nums text-foreground-muted">
            {matchSummary(matchCount, matchIndex)}
          </span>
          <button
            type="button"
            aria-label="Previous match"
            title="Previous match (⇧⌘G)"
            disabled={matchCount === 0}
            className={ICON_BUTTON}
            onClick={() => onStepMatch(-1)}
          >
            <AuricIcon name="arrow_upward" aria-hidden="true" className="text-sm" />
          </button>
          <button
            type="button"
            aria-label="Next match"
            title="Next match (⌘G)"
            disabled={matchCount === 0}
            className={ICON_BUTTON}
            onClick={() => onStepMatch(1)}
          >
            <AuricIcon name="arrow_downward" aria-hidden="true" className="text-sm" />
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          ref={branchButton}
          type="button"
          aria-label={`Branches: ${branchFilterLabel}`}
          aria-haspopup="menu"
          className={BUTTON}
          onClick={() => {
            const box = branchButton.current?.getBoundingClientRect();
            onOpenBranchFilter({ x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 });
          }}
        >
          <AuricIcon name="filter_list" aria-hidden="true" className="text-sm" />
          {branchFilterLabel}
        </button>
        <button
          type="button"
          aria-label="Jump to HEAD"
          title={jumpDisabledReason ?? 'Jump to HEAD'}
          disabled={jumpDisabledReason !== undefined}
          className={ICON_BUTTON}
          onClick={onJumpToHead}
        >
          <AuricIcon name="commit" aria-hidden="true" className="text-sm" />
        </button>
        <button
          type="button"
          aria-label="Inspector"
          aria-pressed={inspectorOpen}
          title="Inspector (↩)"
          className={`${ICON_BUTTON} ${inspectorOpen ? 'bg-white/10 text-foreground' : ''}`}
          onClick={onToggleInspector}
        >
          <AuricIcon name="info" aria-hidden="true" className="text-sm" />
        </button>
      </div>
    </div>
  );
}
