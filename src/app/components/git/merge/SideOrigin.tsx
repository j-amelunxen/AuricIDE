'use client';

import { commitAge } from '@/lib/git/merge/conflictOrigins';
import type { OriginCommit } from '@/lib/tauri/gitMerge';

const TOOLTIP_COMMITS = 3;

/**
 * Why one side of a conflict looks the way it does: the commit that last
 * changed its lines since the merge base, in one muted line under the branch
 * label. Renders nothing for a side that did not change, or while unknown.
 */
export function SideOrigin({
  commits,
  now,
}: {
  /** Newest first. */
  commits: readonly OriginCommit[] | undefined;
  now: number;
}) {
  if (!commits || commits.length === 0) return null;
  const [newest, ...rest] = commits;
  const age = commitAge(newest.time, now);
  const tooltip = [
    ...commits
      .slice(0, TOOLTIP_COMMITS)
      .map((c) => `${c.summary} (${c.shortOid}, ${commitAge(c.time, now)})`),
    ...(commits.length > TOOLTIP_COMMITS ? [`and ${commits.length - TOOLTIP_COMMITS} more`] : []),
  ].join('\n');
  const earlier =
    rest.length === 0 ? '' : `, and ${rest.length} earlier commit${rest.length === 1 ? '' : 's'}`;

  return (
    <p
      data-testid="side-origin"
      title={tooltip}
      className="flex min-w-0 items-baseline gap-1 text-[10px] leading-4 text-foreground-muted"
    >
      <span className="sr-only">{`Changed in commit ${newest.summary}, ${age}${earlier}`}</span>
      <span aria-hidden="true" className="min-w-0 truncate">
        {newest.summary} · <span className="font-mono">{newest.shortOid}</span> · {age}
      </span>
      {rest.length > 0 && (
        <span aria-hidden="true" className="shrink-0">
          +{rest.length}
        </span>
      )}
    </p>
  );
}
