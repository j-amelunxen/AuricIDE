'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  mergeFeedRows,
  mergeStreamFeed,
  toFeedRows,
  type FeedRow,
  type StreamFeedEntry,
} from '@/lib/agents/events/feed';
import type { AgentEventKind } from '@/lib/agents/events/types';
import { streamColorFor } from '@/lib/agents/streamColors';

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

function matchesFilter(kind: AgentEventKind, filter: FeedFilter): boolean {
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

/** Text colour by event kind — a question, a finish and a failure each read
 * differently at a glance; everything else stays the feed's default ink. */
const KIND_TEXT_CLASS: Partial<Record<AgentEventKind, string>> = {
  ask: 'text-amber-400',
  done: 'text-primary-light',
  error: 'text-red-400',
};

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

/** Rows kept above and below the viewport, so a flick of the wheel or a
 * PageDown does not expose blank space before the next paint. */
const WINDOW_OVERSCAN = 6;

/** Stands in until a row and the pane have been measured — and in environments
 * that do no layout at all. A few pane-fulls: never blank, never the backlog. */
const ASSUMED_ROW_HEIGHT = 20;
const ASSUMED_VIEWPORT_HEIGHT = 200;

/**
 * Which slice of a row list is worth putting in the DOM.
 *
 * The feed's pane shows about seven rows; the list behind it holds up to a
 * thousand, and grows at the front several times a second. Rendering all of it
 * means rebuilding a thousand nodes per tick for output nobody can see.
 *
 * Rows are uniform by construction — one line, fixed padding — so a row's
 * offset is a multiplication rather than a measurement, and the two spacers
 * that stand in for the rows outside the window keep the scrollbar honest
 * about how much there is. The height is read from a real row rather than
 * assumed: a wrong constant would drift a pixel per row and, a few hundred
 * rows down, show the wrong ones entirely.
 */
function useRowWindow(total: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState(ASSUMED_ROW_HEIGHT);
  const [viewportHeight, setViewportHeight] = useState(ASSUMED_VIEWPORT_HEIGHT);

  const measure = useCallback(() => {
    const pane = scrollRef.current;
    if (pane && pane.clientHeight > 0) setViewportHeight(pane.clientHeight);
    // The fractional height, not `offsetHeight`: an 11px line rounded to the
    // nearest pixel is half a pixel of drift per row, and a thousand rows of
    // that puts the window tens of rows away from where the reader is.
    const row = rowRef.current?.getBoundingClientRect().height ?? 0;
    if (row > 0) setRowHeight(row);
  }, []);

  // Mount, the arrival of the first row, and a window resize are the three
  // moments the measurements can change; a scroll re-reads them too, which is
  // what catches a late web font.
  const hasRows = total > 0;
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, hasRows]);

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    measure();
  }, [measure]);

  const count = Math.ceil(viewportHeight / rowHeight) + WINDOW_OVERSCAN * 2;
  // Clamped so the window always holds rows: the list shrinks under a filter
  // or a pause while the pane keeps its scroll position.
  const first = Math.min(
    Math.max(0, total - count),
    Math.max(0, Math.floor(scrollTop / rowHeight) - WINDOW_OVERSCAN)
  );
  const last = Math.min(total, first + count);

  return {
    scrollRef,
    rowRef,
    onScroll,
    first,
    last,
    leadingHeight: first * rowHeight,
    trailingHeight: (total - last) * rowHeight,
  };
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
 * The console's merged, live ticker — every tracked agent's output
 * interleaved into one stream. Reads `agentEvents`/`agentStreamLines`/`agents`
 * as stable selectors (the store owns all three references; only the merge
 * output is recomputed, via `useMemo`) so a chunk arriving for one agent does
 * not force a fresh array identity on every render of this list.
 */
export function ActivityFeed({ hint }: ActivityFeedProps = {}) {
  const agentEvents = useStore((s) => s.agentEvents);
  const agentStreamLines = useStore((s) => s.agentStreamLines);
  const agents = useStore((s) => s.agents);
  const agentColors = useStore((s) => s.agentColors);
  const agentLogHistory = useStore((s) => s.agentLogHistory);

  const [mode, setMode] = useState<FeedMode>('activity');
  const [filter, setFilter] = useState<FeedFilter>('all');

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // Two sources, one list: the live events resolved against the running fleet,
  // plus whatever was read back from disk. History rows carry their own name
  // and repo, so an agent that has since exited still shows up by name.
  const events = useMemo<FeedRow[]>(
    () => mergeFeedRows(toFeedRows(agentEvents, agents), agentLogHistory),
    [agentEvents, agents, agentLogHistory]
  );
  // The feed re-renders on every 1s tick from consumers elsewhere in the
  // console (useNow); without this, an unrelated re-render would re-filter
  // the whole entry list for nothing.
  const filteredEvents = useMemo(
    () => events.filter((e) => matchesFilter(e.kind, filter)),
    [events, filter]
  );
  const lines = useMemo<StreamFeedEntry[]>(
    () => mergeStreamFeed(agentStreamLines, agents),
    [agentStreamLines, agents]
  );

  // Pause holds the rows that were on screen when it was pressed. A live feed
  // that scrolls a line away mid-sentence cannot be read, and following it by
  // eye is exactly the oversight tax the console exists to remove. The
  // snapshot is taken in the click handler, not during render, so what is
  // frozen is exactly what the reader was looking at.
  const [frozen, setFrozen] = useState<{
    events: FeedRow[];
    lines: StreamFeedEntry[];
  } | null>(null);
  const shownEvents = frozen?.events ?? filteredEvents;
  const shownLines = frozen?.lines ?? lines;
  const paused = frozen !== null;
  const togglePaused = () => setFrozen(paused ? null : { events: filteredEvents, lines });

  const markFor = (agentId: string) => streamColorFor(agentId, agentColors[agentId]);

  // Windowed over the *shown* rows, never the merged ones — so a pause keeps
  // freezing exactly what the reader was looking at, and the kind filter still
  // decides what there is to scroll through.
  const { scrollRef, rowRef, onScroll, first, last, leadingHeight, trailingHeight } = useRowWindow(
    mode === 'activity' ? shownEvents.length : shownLines.length
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
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

      {/* Focusable on purpose. Only a windowful of rows is in the DOM, so
          scrolling is the only way to the rest — and WebKit, which is what
          Tauri renders with, does not put a scroll region in the tab order by
          itself. Without this, a keyboard reaches the newest hundred rows and
          nothing else. The ring is inset because the pane sits flush against
          the console's border; drawn outside it would cover that border. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label="Agent activity feed"
        data-testid="feed-scroll"
        className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        <div aria-hidden="true" style={{ height: leadingHeight }} />
        {mode === 'activity'
          ? shownEvents.slice(first, last).map((entry, i) => (
              <div
                // The rows a merge already dedupes on: agent, moment, sequence.
                // Position cannot be part of it — the list grows at the front,
                // so every index shifts and React would rebuild the whole pane.
                key={`${entry.agentId}|${entry.at}|${entry.seq ?? 0}`}
                ref={i === 0 ? rowRef : undefined}
                data-testid="feed-row"
                className={`grid grid-cols-[64px_180px_1fr] items-baseline gap-3 px-3 py-0.5 text-foreground-muted ${
                  KIND_TEXT_CLASS[entry.kind] ?? ''
                }`}
              >
                <span className="text-foreground-muted/70">{clockTime(entry.at)}</span>
                {/* The agent's identity colour sits here, on who is
                      speaking — never on the text, which is where the event
                      kind's own colour has to stay readable. */}
                <span
                  data-testid="feed-agent-mark"
                  style={{ color: markFor(entry.agentId) }}
                  className="truncate"
                >
                  <span aria-hidden="true"> · </span>
                  {projectLabel(entry.repoPath)}/{entry.agentName}
                </span>
                <span className="truncate">
                  <span aria-hidden="true"> · </span>
                  {entry.label}
                </span>
              </div>
            ))
          : shownLines.slice(first, last).map((line, i) => {
              const agent = agentById.get(line.agentId);
              return (
                <div
                  // `seq` is monotonic per agent, so the pair identifies the
                  // line for as long as it is in the stream.
                  key={`${line.agentId}|${line.seq}`}
                  ref={i === 0 ? rowRef : undefined}
                  data-testid="feed-row"
                  className="grid grid-cols-[64px_180px_1fr] items-baseline gap-3 px-3 py-0.5 text-foreground-muted"
                >
                  <span className="text-foreground-muted/70">{clockTime(line.at)}</span>
                  <span
                    data-testid="feed-agent-mark"
                    style={{ color: markFor(line.agentId) }}
                    className="truncate"
                  >
                    <span aria-hidden="true"> · </span>
                    {projectLabel(agent?.repoPath)}/{agent?.name ?? line.agentId}
                  </span>
                  <span className="truncate text-foreground">{line.text}</span>
                </div>
              );
            })}
        <div aria-hidden="true" style={{ height: trailingHeight }} />
      </div>
    </div>
  );
}
