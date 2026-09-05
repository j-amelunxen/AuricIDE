'use client';

import { useRef } from 'react';
import type { Lane } from '@/lib/agents/lanes';
import type { LaneSummary } from '@/lib/store/laneSummariesSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { Monogram } from './Monogram';
import { PhaseChip } from './PhaseChip';

const NO_SUMMARIES: Record<string, LaneSummary> = {};

export interface LaneRailProps {
  lanes: Lane[];
  selectedAgentId: string | null;
  onSelect: (agentId: string | null) => void;
  onToggleMute: (agentId: string) => void;
  /** See rule 11 in `docs/design-console-lanes.md` — a summary wins over the
   * generic activity line until it goes stale. */
  laneSummaries?: Record<string, LaneSummary>;
}

/** A summary is only shown while it is still true — an `ask` summary stops
 * being true the moment the agent is no longer waiting on an answer. */
function summaryLineFor(lane: Lane, summary: LaneSummary | undefined): string {
  if (!summary) return lane.rightNow;
  if (summary.kind === 'ask' && !lane.hasQuestion) return lane.rightNow;
  return summary.text;
}

function unreadLabel(unread: number): string {
  return unread > 99 ? '99+' : String(unread);
}

/**
 * The console's conversation list: one row per tracked agent, sorted most
 * actionable first by `buildLanes`, plus an "All lanes" row for the fleet
 * total. Purely presentational — the caller owns the lanes themselves
 * (`buildLanes`) so the rail and the feed it filters never compute the fleet
 * twice.
 */
export function LaneRail({
  lanes,
  selectedAgentId,
  onSelect,
  onToggleMute,
  laneSummaries = NO_SUMMARIES,
}: LaneRailProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const totalUnread = lanes.reduce((sum, lane) => sum + lane.unread, 0);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-lane-row]'));
    const current = rows.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    const next = current + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= rows.length) return;
    event.preventDefault();
    rows[next].focus();
  };

  return (
    <div
      ref={listRef}
      role="list"
      aria-label="Agent lanes"
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-col overflow-y-auto border-r border-white/5 py-1"
    >
      <div role="listitem">
        <button
          type="button"
          data-lane-row
          data-testid="lane-row-all"
          aria-pressed={selectedAgentId === null}
          onClick={() => onSelect(null)}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            selectedAgentId === null
              ? 'bg-white/10 text-foreground'
              : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
          }`}
        >
          All lanes
          {totalUnread > 0 && (
            <span className="ml-auto rounded-full bg-primary/20 px-1.5 py-px text-[10px] font-bold tabular-nums text-primary-light">
              {unreadLabel(totalUnread)}
            </span>
          )}
        </button>
      </div>

      {lanes.map((lane) => {
        const selected = selectedAgentId === lane.agentId;
        const summaryLine = summaryLineFor(lane, laneSummaries[lane.agentId]);

        return (
          <div
            key={lane.agentId}
            role="listitem"
            data-testid={`lane-row-${lane.agentId}`}
            // `group` powers the mute toggle's hover reveal below — a control
            // that isn't the point of the row shouldn't compete with the name
            // for attention until the pointer is actually over the row.
            className="group grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2 px-1.5 py-1"
          >
            <button
              type="button"
              data-lane-row
              aria-pressed={selected}
              onClick={() => onSelect(selected ? null : lane.agentId)}
              className={`col-span-2 grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2 rounded px-1 py-1 text-left transition-colors ${
                selected ? 'bg-white/10' : 'hover:bg-white/5'
              }`}
            >
              {/* Muting dims only the identity, not the content a human still
                  has to be able to act on — the summary, the project label
                  and both badges stay at full strength (rule 14). */}
              <span
                data-testid={`lane-monogram-${lane.agentId}`}
                className={lane.muted ? 'opacity-50' : ''}
              >
                <Monogram monogram={lane.monogram} color={lane.color} />
              </span>
              <span className="min-w-0">
                <span
                  data-testid={`lane-name-${lane.agentId}`}
                  className={`block truncate text-[12px] font-semibold text-foreground ${
                    lane.muted ? 'opacity-50' : ''
                  }`}
                >
                  {lane.agentName}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[10px] text-foreground-muted">
                  <span className="truncate">{lane.projectLabel}</span>
                  <span aria-hidden="true">·</span>
                  <PhaseChip state={lane.state} label={lane.phaseLabel} className="!text-[9px]" />
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-foreground-muted">
                  {summaryLine}
                </span>
              </span>
            </button>

            <div className="flex flex-col items-end gap-1">
              {lane.hasQuestion && (
                <span className="flex items-center gap-0.5 text-amber-400">
                  <AuricIcon name="help" aria-hidden="true" className="text-[13px]" />
                  <span className="sr-only">Needs you</span>
                </span>
              )}
              {lane.unread > 0 && (
                <span
                  data-testid="lane-unread-badge"
                  className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-bold tabular-nums text-foreground-muted"
                >
                  {unreadLabel(lane.unread)}
                </span>
              )}
              <button
                type="button"
                aria-label={lane.muted ? `Unmute ${lane.agentName}` : `Mute ${lane.agentName}`}
                aria-pressed={lane.muted}
                onClick={() => onToggleMute(lane.agentId)}
                // Never amber — that hue is reserved for status, and "muted"
                // is a view preference, not an alert.
                className={`rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted transition-opacity focus-visible:opacity-100 ${
                  lane.muted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {lane.muted ? 'Muted' : 'Mute'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
