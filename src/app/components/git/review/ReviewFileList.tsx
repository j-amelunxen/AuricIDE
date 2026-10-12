'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { statusBadge } from '@/app/components/git/sourceControl/types';
import { RISK_KIND_INFO } from '@/lib/git/review/riskChips';
import type { ReviewFile, ViewedState } from '@/lib/git/review/reviewSession';

const VIEWED_ICON: Record<ViewedState, { name: string; className: string; label: string }> = {
  unviewed: {
    name: 'radio_button_unchecked',
    className: 'text-foreground-muted/80',
    label: 'Not viewed',
  },
  viewed: { name: 'check_circle', className: 'text-emerald-400', label: 'Viewed' },
  'changed-since-viewed': {
    name: 'history',
    className: 'text-amber-400',
    label: 'Changed since you viewed it',
  },
};

function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { dir: '', base: path }
    : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

export interface ReviewFileListEntry {
  file: ReviewFile;
  viewed: ViewedState;
}

/** The change set in review order, with what the reviewer has and has not seen. */
export function ReviewFileList({
  entries,
  currentPath,
  onSelect,
}: {
  entries: readonly ReviewFileListEntry[];
  currentPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <nav aria-label="Files in this review" className="min-h-0 overflow-y-auto py-1">
      <ul>
        {entries.map(({ file, viewed }) => {
          const badge = statusBadge[file.status] ?? statusBadge.untracked;
          const icon = VIEWED_ICON[viewed];
          const { dir, base } = splitPath(file.path);
          const current = file.path === currentPath;
          const high = file.flags.some((flag) => RISK_KIND_INFO[flag.kind].tone === 'high');
          return (
            <li key={file.path}>
              <button
                type="button"
                data-testid="review-file-item"
                data-viewed={viewed}
                aria-current={current ? 'true' : undefined}
                title={file.path}
                onClick={() => onSelect(file.path)}
                className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-hover-bg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                  current ? 'bg-primary/10' : ''
                }`}
              >
                <AuricIcon name={icon.name} className={`shrink-0 text-[13px] ${icon.className}`} />
                <span className="sr-only">{icon.label}, </span>
                <span className={`w-3 shrink-0 text-center font-mono font-bold ${badge.className}`}>
                  {badge.label}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline">
                  <span
                    className={`shrink-0 truncate ${
                      viewed === 'viewed' ? 'text-foreground-muted' : 'text-foreground'
                    }`}
                  >
                    {base}
                  </span>
                  {dir ? (
                    <span className="ml-1.5 min-w-0 truncate text-[11px] text-foreground-muted">
                      {dir}
                    </span>
                  ) : null}
                </span>
                {file.flags.length > 0 ? (
                  <span
                    data-testid="review-file-flag-count"
                    title={`${file.flags.length} risk ${file.flags.length === 1 ? 'flag' : 'flags'}`}
                    className={`shrink-0 rounded px-1 text-[11px] font-medium tabular-nums ${
                      high ? 'bg-amber-500/10 text-amber-300' : 'bg-white/5 text-foreground-muted'
                    }`}
                  >
                    {file.flags.length}
                    <span className="sr-only"> risk flags</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
