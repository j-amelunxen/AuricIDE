'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { mergeActivityFeed, type FeedEntry } from '@/lib/agents/events/feed';
import type { AgentEventKind } from '@/lib/agents/events/types';

type FeedFilter = 'all' | 'ask' | 'edit' | 'done';

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

/**
 * The console's merged, live activity ticker — every tracked agent's events
 * interleaved into one feed. Reads `agentEvents`/`agents` as stable selectors
 * (the store owns both references; only `mergeActivityFeed`'s output is
 * recomputed, via `useMemo`) so a chunk arriving for one agent does not force
 * a fresh array identity on every render of this list.
 */
export function ActivityFeed() {
  const agentEvents = useStore((s) => s.agentEvents);
  const agents = useStore((s) => s.agents);
  const [filter, setFilter] = useState<FeedFilter>('all');

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const entries = useMemo<FeedEntry[]>(
    () => mergeActivityFeed(agentEvents, agents),
    [agentEvents, agents]
  );
  // The feed re-renders on every 1s tick from consumers elsewhere in the
  // console (useNow); without this, an unrelated re-render would re-filter
  // the whole entry list for nothing.
  const visible = useMemo(
    () => entries.filter((e) => matchesFilter(e.kind, filter)),
    [entries, filter]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/5 px-3 py-1.5">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
          Activity
        </h2>
        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          Live
        </span>
        <div className="ml-auto flex gap-0.5">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11px]">
        {visible.map((entry, i) => {
          const agent = agentById.get(entry.agentId);
          return (
            <div
              key={`${entry.agentId}-${entry.at}-${i}`}
              data-testid="feed-row"
              className={`grid grid-cols-[64px_180px_1fr] items-baseline gap-3 px-3 py-0.5 text-foreground-muted ${
                KIND_TEXT_CLASS[entry.kind] ?? ''
              }`}
            >
              <span className="text-foreground-muted/70">{clockTime(entry.at)}</span>
              <span className="truncate text-foreground-muted">
                <span aria-hidden="true"> · </span>
                {projectLabel(agent?.repoPath)}/{agent?.name ?? entry.agentId}
              </span>
              <span className="truncate">
                <span aria-hidden="true"> · </span>
                {entry.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
