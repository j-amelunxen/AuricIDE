'use client';

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import {
  mergeFeedRows,
  mergeStreamFeed,
  toFeedRows,
  toSentFeedRows,
  type FeedRow,
} from '@/lib/agents/events/feed';
import {
  buildLanes,
  feedTier,
  groupBySender,
  isNearBottom,
  isVisibleUnderMute,
  oldestFirst,
  type FeedGroup,
} from '@/lib/agents/lanes';
import { agentMonogram } from '@/lib/agents/naming';
import { streamColorFor } from '@/lib/agents/streamColors';
import type { AgentEventKind } from '@/lib/agents/events/types';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { LaneRail } from './LaneRail';
import { FeedComposer } from './FeedComposer';
import { Monogram } from './Monogram';

/**
 * What the feed is showing.
 *
 * `activity` is the curated list: one row per tool call, permission prompt or
 * recognised line. It is precise and it is incomplete — a provider matcher
 * only recognises the shapes it knows, so anything an agent merely *says*
 * never appears in it.
 *
 * `output` is the readable stream: every line the agent printed, minus redraw
 * chrome and consecutive repeats. Noisier, and the only mode that can answer
 * "what is it actually telling me right now".
 */
type FeedMode = 'activity' | 'output';

type FeedFilter = 'all' | 'ask' | 'edit' | 'done';

const MODES: { key: FeedMode; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'output', label: 'All output' },
];

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ask', label: 'Questions' },
  { key: 'edit', label: 'Changes' },
  { key: 'done', label: 'Completions' },
];

/** `sent` rows are the composer's own echo — they only belong under "All",
 * never under a kind filter that classifies *events*. */
function matchesFilter(kind: AgentEventKind | 'sent', filter: FeedFilter): boolean {
  if (kind === 'sent') return filter === 'all';
  switch (filter) {
    case 'all':
      return true;
    case 'ask':
      return kind === 'ask';
    case 'edit':
      return kind === 'edit' || kind === 'run';
    case 'done':
      return kind === 'done' || kind === 'error';
  }
}

function clockTime(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function projectLabel(repoPath: string | undefined): string {
  if (!repoPath) return 'Unknown';
  return repoPath.split('/').pop() || repoPath;
}

/** Only the newest this many shown rows are in the DOM — see rule 6. */
const FEED_RENDER_LIMIT = 300;
/** How many more "Show earlier" reveals at a time. */
const FEED_REVEAL_STEP = 300;

/**
 * A stream line, recast as a `FeedRow` so grouping, mute filtering and
 * ordering can run through the same code as the curated feed. `note` is the
 * tier that fits: this is prose an agent said, not a tool call — and, not
 * incidentally, a `note` row is also hidden under a muted lane exactly the
 * way the design calls for stream lines to behave.
 */
function streamLinesAsRows(
  lines: { agentId: string; text: string; at: number; seq: number }[],
  agentById: Map<string, { name: string; repoPath?: string }>
): FeedRow[] {
  return lines.map((line) => {
    const agent = agentById.get(line.agentId);
    return {
      agentId: line.agentId,
      agentName: agent?.name || line.agentId,
      repoPath: agent?.repoPath,
      kind: 'note',
      label: line.text,
      at: line.at,
      seq: line.seq,
    };
  });
}

/** Identity of a row for React's list reconciliation and for the group
 * header key — the same triple `mergeFeedRows` dedupes on. */
function feedRowKey(row: FeedRow): string {
  const seqPart = row.kind === 'sent' ? `s${row.seq ?? 0}` : `${row.seq ?? 0}`;
  return `${row.agentId}|${row.at}|${seqPart}`;
}

/**
 * Memoized: with up to 300 rows in the DOM (rule 6 retired the fixed-height
 * window), a re-render that doesn't actually change a row's content — the
 * once-a-second `now` tick, an unrelated store write — must not reconcile
 * all 300 of them.
 */
const FeedRowView = memo(function FeedRowView({ row }: { row: FeedRow }) {
  const time = clockTime(row.at);
  const tier = feedTier(row.kind);
  const timeCell = (
    <span className="w-11 flex-shrink-0 text-[10px] text-foreground-muted/70">{time}</span>
  );

  if (tier === 'you') {
    return (
      <div data-testid="feed-row" className="flex px-3 py-1">
        {timeCell}
        <span className="sr-only">You</span>
        <p className="ml-auto max-w-[60%] rounded-2xl bg-primary/15 px-3 py-1.5 text-[12px] text-foreground">
          {row.label}
        </p>
      </div>
    );
  }

  if (tier === 'mention') {
    return (
      <div
        data-testid="feed-row"
        className="flex items-baseline gap-3 px-3 py-1 text-[12px] font-semibold text-amber-400"
      >
        {timeCell}
        <span className="flex min-w-0 items-start gap-1.5">
          <AuricIcon name="help" aria-hidden="true" className="mt-0.5 flex-shrink-0 text-[14px]" />
          <span className="sr-only">Question</span>
          {/* A permission question is the row most likely to run long, and
              the one a human most needs to be able to read in full. */}
          <span className="line-clamp-3">{row.label}</span>
        </span>
      </div>
    );
  }

  if (tier === 'outcome') {
    const failed = row.kind === 'error';
    return (
      <div
        data-testid="feed-row"
        className={`flex items-baseline gap-3 px-3 py-1 text-[12px] font-semibold ${
          failed ? 'text-red-400' : 'text-primary-light'
        }`}
      >
        {timeCell}
        <span className="flex min-w-0 items-start gap-1.5">
          <AuricIcon
            name={failed ? 'error' : 'check_circle'}
            aria-hidden="true"
            className="mt-0.5 flex-shrink-0 text-[14px]"
          />
          <span className="sr-only">{failed ? 'Failed' : 'Finished'}</span>
          <span className="line-clamp-3">{row.label}</span>
        </span>
      </div>
    );
  }

  if (tier === 'prose') {
    return (
      <div data-testid="feed-row" className="flex items-baseline gap-3 px-3 py-1">
        {timeCell}
        <p className="line-clamp-3 max-w-[72ch] text-[12px] leading-snug text-foreground">
          {row.label}
        </p>
      </div>
    );
  }

  // `system`: a tool call — small, muted, one line, monospace.
  return (
    <div data-testid="feed-row" className="flex items-baseline gap-3 px-3 py-0.5">
      {timeCell}
      <span className="truncate font-mono text-[11px] text-foreground-muted">{row.label}</span>
    </div>
  );
});

const FeedGroupBlock = memo(function FeedGroupBlock({
  group,
  color,
}: {
  group: FeedGroup;
  color: string;
}) {
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

/**
 * The newest `revealedCount` rows of `groups`, trimmed at the group level
 * rather than by re-slicing rows before grouping.
 *
 * That distinction is the whole point: `groups` is memoized on the full
 * `shown` list, so an unaffected group is the *same object* across renders.
 * Slicing rows first and grouping the slice (the old approach) rebuilt every
 * group from scratch on every arrival, and the boundary group's key — its
 * own first row — changed on every tick as the slice edge marched through
 * it, remounting a DOM block that never actually left the screen. Keying by
 * the *original* group's first row here means that block keeps its identity
 * for as long as any part of it is still visible, and only remounts once it
 * has genuinely scrolled out of the window.
 */
function trimGroupsToWindow(
  groups: FeedGroup[],
  revealedCount: number
): { key: string; group: FeedGroup }[] {
  const result: { key: string; group: FeedGroup }[] = [];
  let remaining = revealedCount;
  for (let i = groups.length - 1; i >= 0 && remaining > 0; i--) {
    const original = groups[i];
    const key = feedRowKey(original.rows[0]);
    if (original.rows.length <= remaining) {
      result.unshift({ key, group: original });
      remaining -= original.rows.length;
    } else {
      const rows = original.rows.slice(original.rows.length - remaining);
      result.unshift({ key, group: { ...original, rows } });
      remaining = 0;
    }
  }
  return result;
}

export interface ActivityFeedProps {
  /**
   * The console's keyboard hint, shown at the right of this header. It lives
   * here rather than in a strip of its own between the grid and the feed —
   * that strip read as an overlay sitting on the ACTIVITY row.
   */
  hint?: string;
}

/**
 * The console's message-hierarchy feed: a lane rail on the left, one merged
 * stream on the right, oldest first — see `docs/design-console-lanes.md`.
 */
export function ActivityFeed({ hint }: ActivityFeedProps = {}) {
  const agents = useStore((s) => s.agents);
  const agentEvents = useStore((s) => s.agentEvents);
  const agentStreamLines = useStore((s) => s.agentStreamLines);
  const agentColors = useStore((s) => s.agentColors);
  const agentLogHistory = useStore((s) => s.agentLogHistory);
  const agentSentMessages = useStore((s) => s.agentSentMessages);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  const mutedAgentIds = useStore((s) => s.mutedAgentIds);
  const laneSeenAt = useStore((s) => s.laneSeenAt);
  const laneSummaries = useStore((s) => s.laneSummaries);
  const markLaneSeen = useStore((s) => s.markLaneSeen);
  const toggleAgentMuted = useStore((s) => s.toggleAgentMuted);
  const sendAgentInput = useStore((s) => s.sendAgentInput);

  const [mode, setMode] = useState<FeedMode>('activity');
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [revealedCount, setRevealedCount] = useState(FEED_RENDER_LIMIT);
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const now = useNow();
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const lanes = useMemo(
    () =>
      buildLanes({
        agents,
        agentEvents,
        agentColors,
        reviewedAgentIds,
        mutedAgentIds,
        laneSeenAt,
        now,
      }),
    [agents, agentEvents, agentColors, reviewedAgentIds, mutedAgentIds, laneSeenAt, now]
  );
  const selectedLane = selectedAgentId
    ? (lanes.find((lane) => lane.agentId === selectedAgentId) ?? null)
    : null;

  // Two sources, one list: the live events resolved against the running
  // fleet plus the human's own sent messages, plus whatever was read back
  // from disk. Oldest first — the feed's reading direction.
  const activityRows = useMemo<FeedRow[]>(
    () =>
      oldestFirst(
        mergeFeedRows(
          [...toFeedRows(agentEvents, agents), ...toSentFeedRows(agentSentMessages, agents)],
          agentLogHistory
        )
      ),
    [agentEvents, agents, agentSentMessages, agentLogHistory]
  );
  const outputRows = useMemo<FeedRow[]>(
    () => oldestFirst(streamLinesAsRows(mergeStreamFeed(agentStreamLines, agents), agentById)),
    [agentStreamLines, agents, agentById]
  );
  const rows = mode === 'activity' ? activityRows : outputRows;

  const filteredRows = useMemo(() => {
    const byKind =
      mode === 'activity' ? rows.filter((row) => matchesFilter(row.kind, filter)) : rows;
    if (selectedAgentId) return byKind.filter((row) => row.agentId === selectedAgentId);
    return byKind.filter((row) => isVisibleUnderMute(row, mutedAgentIds));
  }, [rows, mode, filter, selectedAgentId, mutedAgentIds]);

  // Pause holds the rows that were on screen when it was pressed. A live feed
  // that scrolls a line away mid-sentence cannot be read, and following it by
  // eye is exactly the oversight tax the console exists to remove.
  const [frozen, setFrozen] = useState<FeedRow[] | null>(null);
  const shown = frozen ?? filteredRows;
  const paused = frozen !== null;
  const togglePaused = () => setFrozen(paused ? null : filteredRows);

  const hiddenCount = Math.max(0, shown.length - revealedCount);
  // Grouped once over the full (unwindowed) list and memoized on `shown`
  // alone — so a render that doesn't change `shown` (the `now` tick, a
  // store write to something else entirely) reuses the exact same group and
  // row objects, and `FeedGroupBlock`/`FeedRowView`'s memo actually bites.
  const groups = useMemo(() => groupBySender(shown), [shown]);
  const visibleGroups = useMemo(
    () => trimGroupsToWindow(groups, revealedCount),
    [groups, revealedCount]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKey = `${filter}|${mode}|${selectedAgentId ?? ''}`;
  const prevContextRef = useRef<string | null>(null);
  const prevLenRef = useRef(0);

  // "Show N earlier" prepends rows above whatever the reader is looking at.
  // Left alone, the browser holds `scrollTop` steady while the content above
  // it grows, which reads as the viewport jumping down. Stashed here at
  // click time and corrected once the reveal has actually landed in the DOM.
  const pendingRevealAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingRevealAnchorRef.current;
    if (!pending) return;
    pendingRevealAnchorRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = pending.scrollTop + (el.scrollHeight - pending.scrollHeight);
  }, [revealedCount]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const contextChanged = prevContextRef.current !== contextKey;
    const prevLen = prevLenRef.current;
    prevContextRef.current = contextKey;
    prevLenRef.current = shown.length;

    if (contextChanged) {
      setRevealedCount(FEED_RENDER_LIMIT);
      setFollowing(true);
      setNewCount(0);
      if (el) el.scrollTop = el.scrollHeight;
      if (selectedAgentId) markLaneSeen(selectedAgentId, Date.now());
      return;
    }

    const delta = shown.length - prevLen;
    if (delta <= 0) return;
    if (following) {
      if (el) el.scrollTop = el.scrollHeight;
      // Growth only stands for "the lane's events grew" in the one context
      // where `shown` is actually built from those events: activity mode,
      // unfiltered. In output mode `shown` grows from stream lines, and
      // under a kind filter it can grow from a kind the reader isn't even
      // looking at — neither means the lane's own events were seen.
      if (selectedAgentId && mode === 'activity' && filter === 'all') {
        markLaneSeen(selectedAgentId, Date.now());
      }
    } else {
      setNewCount((n) => n + delta);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, contextKey, following]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
    setFollowing(near);
    if (near) setNewCount(0);
  }, []);

  const jumpToNew = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
    setNewCount(0);
    if (selectedAgentId && mode === 'activity' && filter === 'all') {
      markLaneSeen(selectedAgentId, Date.now());
    }
  };

  const revealEarlier = () => {
    const el = scrollRef.current;
    if (el)
      pendingRevealAnchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
    setRevealedCount((c) => Math.min(shown.length, c + FEED_REVEAL_STEP));
  };

  const handleSelectLane = (agentId: string | null) => setSelectedAgentId(agentId);

  const handleComposerSend = (text: string) => {
    if (!selectedLane) return;
    void sendAgentInput(selectedLane.agentId, `${text}\n`);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[224px_minmax(0,1fr)]">
      <LaneRail
        lanes={lanes}
        selectedAgentId={selectedAgentId}
        onSelect={handleSelectLane}
        onToggleMute={toggleAgentMuted}
        laneSummaries={laneSummaries}
      />

      <div className="flex h-full min-h-0 flex-col border-l border-white/5">
        <div
          data-testid="activity-feed-header"
          className="flex flex-shrink-0 items-center gap-3 border-b border-white/5 px-3 py-1.5"
        >
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
            Activity
          </h2>
          <button
            type="button"
            onClick={togglePaused}
            aria-pressed={paused}
            aria-label={paused ? 'Resume the feed' : 'Pause the feed'}
            className={`flex items-center gap-1 rounded px-1 text-[10px] transition-colors ${
              paused ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {paused ? 'Paused' : 'Live'}
          </button>

          <div className="flex gap-0.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                onClick={() => setMode(m.key)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  mode === m.key
                    ? 'bg-white/10 text-foreground'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {selectedLane && (
            <span
              data-testid="feed-lane-chip"
              className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-foreground"
            >
              Lane: {selectedLane.agentName}
              <button
                type="button"
                onClick={() => handleSelectLane(null)}
                aria-label={`Clear the ${selectedLane.agentName} lane filter`}
                className="text-foreground-muted transition-colors hover:text-foreground"
              >
                ×
              </button>
            </span>
          )}

          {hint && (
            <span className="ml-auto truncate text-[10px] text-foreground-muted/60">{hint}</span>
          )}

          {/* The kind filters classify *events*; in output mode there are no
              kinds to filter by, so offering them would be a dead control. */}
          {mode === 'activity' && (
            <div className={`flex gap-0.5 ${hint ? '' : 'ml-auto'}`}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    filter === f.key
                      ? 'bg-white/10 text-foreground'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {/* Focusable on purpose. WebKit, which is what Tauri renders with,
              does not put a scroll region in the tab order by itself. */}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            tabIndex={0}
            role="region"
            aria-label="Agent activity feed"
            data-testid="feed-scroll"
            className="h-full overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
          >
            {hiddenCount > 0 && (
              <div className="px-3 py-1">
                <button
                  type="button"
                  onClick={revealEarlier}
                  className="rounded border border-white/10 px-2 py-1 text-[10px] text-foreground-muted transition-colors hover:text-foreground"
                >
                  Show {Math.min(FEED_REVEAL_STEP, hiddenCount)} earlier
                </button>
              </div>
            )}
            {visibleGroups.map(({ key, group }) => (
              <FeedGroupBlock
                key={key}
                group={group}
                color={streamColorFor(group.agentId, agentColors[group.agentId])}
              />
            ))}
          </div>

          {/* Always mounted — a live region that only appears once there is
              something to announce is a live region a screen reader has
              nothing to attach to beforehand. Empty and invisible when there
              is nothing new; renders the pill in place once there is. */}
          <div
            role="status"
            aria-live="polite"
            className="absolute bottom-3 left-1/2 -translate-x-1/2"
          >
            {newCount > 0 && (
              <button
                type="button"
                onClick={jumpToNew}
                className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-white shadow-lg transition-colors hover:bg-primary/90"
              >
                {newCount} new ↓
              </button>
            )}
          </div>
        </div>

        <FeedComposer lane={selectedLane} onSend={handleComposerSend} />
      </div>
    </div>
  );
}
