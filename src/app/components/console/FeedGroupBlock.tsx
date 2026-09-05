'use client';

import { memo } from 'react';
import { feedRowKey } from '@/lib/agents/events/feed';
import { projectLabel, type FeedGroup } from '@/lib/agents/lanes';
import { agentMonogram } from '@/lib/agents/naming';
import { Monogram } from './Monogram';
import { FeedRowView } from './FeedRowView';

export interface FeedGroupBlockProps {
  group: FeedGroup;
  /** The sender's identity colour — the marker if the user set one, else an
   * auto-assigned hue. Resolved by the caller, once per agent per render. */
  color: string;
}

/**
 * One sender run: a header carrying the monogram, agent name and project
 * label, followed by its rows. Memoized alongside `FeedRowView` — see the
 * identity note on `trimGroupsToWindow` for why a group keeps the same
 * object across renders whenever nothing in it actually changed.
 */
export const FeedGroupBlock = memo(function FeedGroupBlock({ group, color }: FeedGroupBlockProps) {
  return (
    <div data-testid="feed-group" className="pt-2 first:pt-0">
      <div className="flex items-center gap-2 px-3 pb-1">
        <Monogram monogram={agentMonogram(group.agentName)} color={color} />
        <span className="max-w-[40ch] truncate text-[12px] font-semibold text-foreground">
          {group.agentName}
        </span>
        <span className="truncate text-[10px] text-foreground-muted">
          {projectLabel(group.repoPath)}
        </span>
      </div>
      {group.rows.map((row) => (
        <FeedRowView key={feedRowKey(row)} row={row} />
      ))}
    </div>
  );
});
