'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { useFeedFollow } from '@/lib/hooks/useFeedFollow';
import {
  mergeFeedRows,
  mergeStreamFeed,
  toFeedRows,
  toSentFeedRows,
  toStreamFeedRows,
  type FeedRow,
  type FeedRowKind,
} from '@/lib/agents/events/feed';
import { buildLanes, groupBySender, isVisibleUnderMute, oldestFirst } from '@/lib/agents/lanes';
import { FEED_REVEAL_STEP, trimGroupsToWindow } from '@/lib/agents/feedWindow';
import { streamColorFor } from '@/lib/agents/streamColors';
import { LaneRail } from './LaneRail';
import { FeedComposer } from './FeedComposer';
import { FeedGroupBlock } from './FeedGroupBlock';
import { FeedToggle } from './FeedToggle';

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

/** `sent` and `line` rows are never classified events — `sent` is the
 * composer's own echo, `line` only ever appears in output mode — so neither
 * belongs under a kind filter that classifies *events*. */
function matchesFilter(kind: FeedRowKind, filter: FeedFilter): boolean {
  if (kind === 'sent' || kind === 'line') return filter === 'all';
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

  const now = useNow();

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

  // Rule 12: selecting a lane marks it seen. Scoped to the selection itself
  // rather than to every context change, so switching the filter or mode
  // while a lane stays selected doesn't quietly re-mark it.
  useEffect(() => {
    if (selectedAgentId) markLaneSeen(selectedAgentId, Date.now());
  }, [selectedAgentId, markLaneSeen]);

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
    () => oldestFirst(toStreamFeedRows(mergeStreamFeed(agentStreamLines, agents), agents)),
    [agentStreamLines, agents]
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

  // Grouped once over the full (unwindowed) list and memoized on `shown`
  // alone — so a render that doesn't change `shown` (the `now` tick, a
  // store write to something else entirely) reuses the exact same group and
  // row objects, and `FeedGroupBlock`/`FeedRowView`'s memo actually bites.
  const groups = useMemo(() => groupBySender(shown), [shown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKey = `${filter}|${mode}|${selectedAgentId ?? ''}`;

  // Growth only stands for "the lane's events grew" in the one context
  // where `shown` is actually built from those events: activity mode,
  // unfiltered. In output mode `shown` grows from stream lines, and under a
  // kind filter it can grow from a kind the reader isn't even looking at —
  // neither means the lane's own events were seen.
  const markSeenIfWatchingActivity = () => {
    if (selectedAgentId && mode === 'activity' && filter === 'all') {
      markLaneSeen(selectedAgentId, Date.now());
    }
  };

  const { newCount, revealedCount, hiddenCount, onScroll, jumpToNew, revealEarlier } =
    useFeedFollow({
      scrollRef,
      rowCount: shown.length,
      contextKey,
      onGrowthSeen: markSeenIfWatchingActivity,
    });

  const visibleGroups = useMemo(
    () => trimGroupsToWindow(groups, revealedCount),
    [groups, revealedCount]
  );

  const handleJumpToNew = () => {
    jumpToNew();
    markSeenIfWatchingActivity();
  };

  const handleComposerSend = (text: string) => {
    if (!selectedLane) return;
    void sendAgentInput(selectedLane.agentId, `${text}\n`);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[224px_minmax(0,1fr)]">
      <LaneRail
        lanes={lanes}
        selectedAgentId={selectedAgentId}
        onSelect={setSelectedAgentId}
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

          <FeedToggle options={MODES} value={mode} onChange={setMode} />

          {selectedLane && (
            <span
              data-testid="feed-lane-chip"
              className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-foreground"
            >
              Lane: {selectedLane.agentName}
              <button
                type="button"
                onClick={() => setSelectedAgentId(null)}
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
            <FeedToggle
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              className={hint ? '' : 'ml-auto'}
            />
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
                onClick={handleJumpToNew}
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
