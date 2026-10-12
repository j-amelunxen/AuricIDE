'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { ReviewSource } from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';

function repoName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/** Opens (or refreshes) a review session and its tab. Returns the tab id. */
export function openReviewTab(source: ReviewSource): string {
  const store = useStore.getState();
  const id = store.openReviewSession(source);
  store.openTab({ id, path: source.repoPath, name: `Review: ${repoName(source.repoPath)}` });
  return id;
}

/** "Review changes" for a repo's working tree: every changed file in one tab. */
export function ReviewChangesButton({
  repoPath,
  className,
}: {
  repoPath: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid="review-changes-button"
      onClick={() => openReviewTab({ kind: 'worktree', repoPath })}
      title="Review every change in this repo in one tab"
      className={
        className ??
        'flex min-h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary motion-safe:active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
      }
    >
      <AuricIcon name="fact_check" className="text-sm" />
      Review changes
    </button>
  );
}
