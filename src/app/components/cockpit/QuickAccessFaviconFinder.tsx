'use client';

import { useEffect, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { findProjectIconCandidates, type ProjectIconCandidate } from '@/lib/tauri/projectIcons';
import { getCachedImageIcon, loadImageIcon } from '@/lib/quickAccess/imageIconCache';

interface QuickAccessFaviconFinderProps {
  projectPath: string;
  /** The image path currently on the tile, or '' when it shows something else. */
  value: string;
  onSelect: (path: string) => void;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/** Renders a candidate's actual pixels, so the choice is made by eye. */
function CandidateThumb({ path }: { path: string }) {
  const [dataUri, setDataUri] = useState(() => getCachedImageIcon(path) ?? null);

  useEffect(() => {
    let cancelled = false;
    void loadImageIcon(path).then((loaded) => {
      if (!cancelled) setDataUri(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!dataUri) {
    return <span className="h-6 w-6 shrink-0 rounded bg-white/5" aria-hidden="true" />;
  }
  // A data URI from the user's own disk, not a remote asset next/image could
  // optimise.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={dataUri} alt="" aria-hidden="true" className="h-6 w-6 shrink-0 object-contain" />
  );
}

/**
 * Finds the project's own icon on disk instead of asking the user to.
 *
 * A favicon is rarely where you would guess — `apps/web/public/`, `static/`,
 * six levels into a monorepo — so hunting for it by hand is exactly the chore
 * this is here to remove. The scan ranks conventional names and locations,
 * skips dependency directories, and shows what it found as pictures rather
 * than as paths.
 */
export function QuickAccessFaviconFinder({
  projectPath,
  value,
  onSelect,
}: QuickAccessFaviconFinderProps) {
  const [candidates, setCandidates] = useState<ProjectIconCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    setSearching(true);
    try {
      setCandidates(await findProjectIconCandidates(projectPath));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-testid="quick-access-find-favicon"
        onClick={() => void search()}
        disabled={searching}
        className="flex items-center gap-1.5 rounded bg-white/5 px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
      >
        <AuricIcon name="search" aria-hidden="true" className="text-[14px]" />
        {searching ? 'Searching…' : 'Search for favicon'}
      </button>

      {candidates !== null && (
        <div data-testid="quick-access-favicon-results">
          {candidates.length === 0 ? (
            <p className="text-[10px] text-foreground-muted/70">
              No favicon or logo found in this project.
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
              {candidates.map((candidate) => (
                <li key={candidate.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(candidate.path)}
                    aria-pressed={candidate.path === value}
                    className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                      candidate.path === value
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-white/5 hover:bg-white/5'
                    }`}
                  >
                    <CandidateThumb path={candidate.path} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-foreground">
                        {candidate.fileName}
                      </span>
                      <span
                        title={candidate.relativePath}
                        className="block truncate font-mono text-[9px] text-foreground-muted"
                      >
                        {candidate.relativePath}
                      </span>
                    </span>
                    <span className="shrink-0 text-[9px] text-foreground-muted/60">
                      {formatSize(candidate.sizeBytes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
