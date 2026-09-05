'use client';

import { memo } from 'react';
import type { FeedRow } from '@/lib/agents/events/feed';
import { feedTier, type FeedTier } from '@/lib/agents/lanes';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface TierIcon {
  name: string;
  /** The accessible name a screen reader gets in place of the icon. */
  label: string;
}

/**
 * Every row-dependent field is a function of the row, even where the answer
 * is a constant: one shape for the whole table, no runtime "is this a
 * function?" check and no cast to get the answer back out.
 */
interface TierPresentation {
  /** Classes appended after the shared `flex` base. */
  rowClassName: (row: FeedRow) => string;
  /** Classes for the row's text, or for the flex wrapper around an icon. */
  contentClassName: string;
  /** Present on `mention` and `outcome` — the two tiers that may shout. */
  icon?: (row: FeedRow) => TierIcon;
  /** `you` is the one right-aligned bubble; everything else reads left. */
  bubble?: boolean;
  /** `prose` renders as a paragraph; every other plain-text tier as a span. */
  tag: 'p' | 'span';
}

/**
 * How each tier renders — the console's message hierarchy
 * (`docs/design-console-lanes.md`) reduced to data. `mention` and `outcome`
 * are the only tiers a screen reader needs an icon label for; `outcome`
 * additionally distinguishes done from error.
 */
const TIER_PRESENTATION: Record<FeedTier, TierPresentation> = {
  you: {
    rowClassName: () => 'px-3 py-1',
    contentClassName:
      'ml-auto max-w-[60%] rounded-2xl bg-primary/15 px-3 py-1.5 text-[12px] text-foreground',
    bubble: true,
    tag: 'p',
  },
  mention: {
    rowClassName: () => 'items-baseline gap-3 px-3 py-1 text-[12px] font-semibold text-amber-400',
    contentClassName: 'flex min-w-0 items-start gap-1.5',
    icon: () => ({ name: 'help', label: 'Question' }),
    tag: 'span',
  },
  outcome: {
    rowClassName: (row) =>
      `items-baseline gap-3 px-3 py-1 text-[12px] font-semibold ${
        row.kind === 'error' ? 'text-red-400' : 'text-primary-light'
      }`,
    contentClassName: 'flex min-w-0 items-start gap-1.5',
    icon: (row) =>
      row.kind === 'error'
        ? { name: 'error', label: 'Failed' }
        : { name: 'check_circle', label: 'Finished' },
    tag: 'span',
  },
  prose: {
    rowClassName: () => 'items-baseline gap-3 px-3 py-1',
    contentClassName: 'line-clamp-3 max-w-[72ch] text-[12px] leading-snug text-foreground',
    tag: 'p',
  },
  system: {
    rowClassName: () => 'items-baseline gap-3 px-3 py-0.5',
    contentClassName: 'truncate font-mono text-[11px] text-foreground-muted',
    tag: 'span',
  },
};

function clockTime(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * One row of the feed, styled by its tier. Memoized: with up to 300 rows in
 * the DOM (rule 6 retired the fixed-height window), a re-render that doesn't
 * actually change a row's content — the once-a-second `now` tick, an
 * unrelated store write — must not reconcile all 300 of them.
 */
export const FeedRowView = memo(function FeedRowView({ row }: { row: FeedRow }) {
  const presentation = TIER_PRESENTATION[feedTier(row.kind)];
  const rowClassName = presentation.rowClassName(row);
  const contentClassName = presentation.contentClassName;
  const icon = presentation.icon?.(row);

  const timeCell = (
    <span className="w-11 flex-shrink-0 text-[10px] text-foreground-muted/70">
      {clockTime(row.at)}
    </span>
  );

  if (presentation.bubble) {
    return (
      <div data-testid="feed-row" className={`flex ${rowClassName}`}>
        {timeCell}
        <span className="sr-only">You</span>
        <p className={contentClassName}>{row.label}</p>
      </div>
    );
  }

  if (icon) {
    return (
      <div data-testid="feed-row" className={`flex ${rowClassName}`}>
        {timeCell}
        <span className={contentClassName}>
          <AuricIcon
            name={icon.name}
            aria-hidden="true"
            className="mt-0.5 flex-shrink-0 text-[14px]"
          />
          <span className="sr-only">{icon.label}</span>
          {/* The row most likely to run long — the reader needs the whole
              thing, not the first line of it. */}
          <span className="line-clamp-3">{row.label}</span>
        </span>
      </div>
    );
  }

  const Tag = presentation.tag;
  return (
    <div data-testid="feed-row" className={`flex ${rowClassName}`}>
      {timeCell}
      <Tag className={contentClassName}>{row.label}</Tag>
    </div>
  );
});
