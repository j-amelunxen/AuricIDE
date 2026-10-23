'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { formatAgentDuration } from '@/lib/agents/duration';
import { hasTerminal } from '@/lib/agents/fleet';
import { agentState, agentStateLabel, type AgentState } from '@/lib/agents/state';
import {
  TIMELINE_RANGES,
  type SupervisorTimelineModel,
  type TimelineHandoff,
  type TimelineRangeId,
  type TimelineRow,
  type TimelineTone,
} from '@/lib/agents/supervisorTimeline';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

const BAR_TONE: Record<TimelineTone, string> = {
  running: 'border-primary/50 bg-primary/25 text-primary-light',
  done: 'border-white/10 bg-white/10 text-foreground-muted',
  error: 'border-red-400/40 bg-red-500/20 text-red-300',
  queued: 'border-dashed border-primary/40 bg-transparent text-foreground-muted',
};

const ROW_GRID =
  'grid h-10 w-full grid-cols-[11rem_minmax(0,1fr)] border-b border-white/5 text-left';

/**
 * The header control that folds the chart down. It lives in the empty stretch
 * between the supervisor's name and the agent id, and it stays quiet until
 * someone asks for the overview.
 */
export function SupervisorTimelineToggle({
  open,
  runningCount,
  onToggle,
}: {
  open: boolean;
  runningCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="supervisor-timeline-toggle"
      aria-expanded={open}
      aria-controls="supervisor-timeline"
      aria-label={open ? 'Hide agent timeline' : 'Show agent timeline'}
      onClick={onToggle}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-medium transition-transform duration-150 active:scale-[0.96] ${
        open
          ? 'border-primary/40 bg-primary/15 text-foreground'
          : 'border-white/10 text-foreground-muted hover:bg-white/5 hover:text-foreground'
      }`}
    >
      <AuricIcon name="schedule" aria-hidden="true" className="text-sm" />
      <span>Timeline</span>
      {runningCount > 0 && (
        <span className="tabular-nums text-primary-light">{runningCount} running</span>
      )}
    </button>
  );
}

export function SupervisorTimelinePanel({
  model,
  range,
  onRange,
  now,
  currentAgentId,
  onOpenAgent,
}: {
  model: SupervisorTimelineModel;
  range: TimelineRangeId;
  onRange: (range: TimelineRangeId) => void;
  now: number;
  currentAgentId: string;
  onOpenAgent: (agent: AgentInfo) => void;
}) {
  const onlySupervisor = model.rows.length === 1 && model.outsideCount === 0;
  return (
    <section
      id="supervisor-timeline"
      data-testid="supervisor-timeline"
      aria-label="Agent timeline"
      className="max-h-64 overflow-y-auto border-b border-white/10 bg-black/30"
    >
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0b0b16]">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-balance text-[13px] font-semibold text-foreground">Agents</h3>
            <span className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="tabular-nums">{model.runningCount} running</span>
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label="Time range"
            className="flex shrink-0 items-center rounded-lg border border-white/10 p-0.5"
          >
            {TIMELINE_RANGES.map((item) => {
              const selected = item.id === range;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onRange(item.id)}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors duration-150 ${
                    selected
                      ? 'bg-white/10 text-foreground'
                      : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-[11rem_minmax(0,1fr)]">
          <span />
          <span className="relative h-5">
            {model.ticks.map((tick) => (
              <span
                key={tick.label}
                className={`absolute top-0 text-[9px] tabular-nums ${
                  tick.label === 'now'
                    ? 'right-1 text-primary'
                    : '-translate-x-1/2 text-foreground-muted/70'
                }`}
                style={tick.label === 'now' ? undefined : { left: `${tick.at * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </span>
        </div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 right-0 left-[11rem]">
          {model.ticks
            .filter((tick) => tick.label !== 'now')
            .map((tick) => (
              <span
                key={tick.label}
                className="absolute inset-y-0 w-px bg-white/10"
                style={{ left: `${tick.at * 100}%` }}
              />
            ))}
          <svg
            viewBox={`0 0 1000 ${Math.max(model.rows.length, 1)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full text-foreground-muted/60"
            aria-hidden="true"
          >
            {model.handoffs.map((link) => (
              <path
                key={`${link.fromId}-${link.toId}`}
                data-testid={`timeline-handoff-${link.fromId}-${link.toId}`}
                d={handoffPath(link)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>

        {model.rows.map((row) => (
          <TimelineRowView
            key={row.agent.id}
            row={row}
            now={now}
            current={row.agent.id === currentAgentId}
            onOpen={
              hasTerminal(row.agent) && row.agent.id !== currentAgentId
                ? () => onOpenAgent(row.agent)
                : null
            }
          />
        ))}
      </div>

      {onlySupervisor && (
        <p className="px-3 py-1.5 text-[10px] text-foreground-muted">No agents started yet.</p>
      )}
      {model.outsideCount > 0 && (
        <p className="px-3 py-1.5 text-[10px] text-foreground-muted">
          {model.outsideCount === 1
            ? '1 agent is outside this window.'
            : `${model.outsideCount} agents are outside this window.`}
        </p>
      )}
    </section>
  );
}

function TimelineRowView({
  row,
  now,
  current,
  onOpen,
}: {
  row: TimelineRow;
  now: number;
  current: boolean;
  onOpen: (() => void) | null;
}) {
  const className = `${ROW_GRID} ${current ? 'bg-white/[0.04]' : ''} ${
    onOpen ? 'transition-colors duration-150 hover:bg-white/[0.03]' : ''
  }`;
  const title = rowTitle(row, now);
  const body = (
    <>
      <span
        className="flex h-full min-w-0 items-center gap-2 pr-2"
        style={{ paddingLeft: 12 + row.depth * 12 }}
      >
        <ProviderMark provider={row.agent.provider} />
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            <span
              className={`truncate text-[12px] ${current ? 'font-semibold' : 'font-medium'} text-foreground`}
            >
              {row.agent.name}
            </span>
            <StateBadge agent={row.agent} now={now} />
          </span>
          <span className="block truncate text-[10px] text-foreground-muted">
            {row.agent.model}
          </span>
        </span>
      </span>
      <span className="relative h-full">
        {row.bar && (
          <span
            data-testid={`timeline-bar-${row.agent.id}`}
            data-tone={row.bar.tone}
            className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-md border px-2 text-[10px] font-medium ${
              row.bar.clippedStart ? 'rounded-l-none' : ''
            } ${BAR_TONE[row.bar.tone]}`}
            style={{
              left: `${row.bar.start * 100}%`,
              width: `max(${Math.max(row.bar.end - row.bar.start, 0) * 100}%, 0.5rem)`,
            }}
          >
            <span className="truncate">{row.bar.label}</span>
            {row.bar.tone === 'running' && row.bar.end === 1 && (
              <span className="absolute inset-y-0 right-0 w-0.5 bg-primary motion-safe:animate-pulse" />
            )}
          </span>
        )}
      </span>
    </>
  );

  if (!onOpen) {
    return (
      <div
        data-testid={`timeline-row-${row.agent.id}`}
        aria-current={current ? 'true' : undefined}
        title={title}
        className={className}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`timeline-row-${row.agent.id}`}
      aria-label={`Show ${row.agent.name}`}
      title={title}
      onClick={onOpen}
      className={`${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60`}
    >
      {body}
    </button>
  );
}

function ProviderMark({ provider }: { provider: string }) {
  const name = provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : provider;
  const letters = provider.replace(/[^a-z0-9]/gi, '');
  const mark =
    provider === 'claude'
      ? 'CC'
      : provider === 'codex'
        ? 'CX'
        : (letters.slice(0, 2) || '?').toUpperCase();
  return (
    <span
      title={name}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-[8px] font-bold tracking-wide text-foreground-muted"
    >
      {mark}
    </span>
  );
}

const BADGE_TONE: Partial<Record<AgentState, string>> = {
  error: 'bg-red-500/15 text-red-300',
  'needs-input': 'bg-amber-500/15 text-amber-300',
  stalled: 'bg-amber-500/15 text-amber-300',
};

function StateBadge({ agent, now }: { agent: AgentInfo; now: number }) {
  const state = agentState(agent, now);
  if (state === 'working') return null;
  return (
    <span
      className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${
        BADGE_TONE[state] ?? 'bg-white/10 text-foreground-muted'
      }`}
    >
      {agentStateLabel(state, agent.headless)}
    </span>
  );
}

function rowTitle(row: TimelineRow, now: number): string {
  const state = agentStateLabel(agentState(row.agent, now), row.agent.headless);
  const running = row.agent.status === 'running' || row.agent.status === 'queued';
  const ended = running
    ? now
    : (row.agent.finishedAt ?? row.agent.lastActivityAt ?? row.agent.startedAt);
  const duration = formatAgentDuration(Math.max(0, ended - row.agent.startedAt));
  const task = row.agent.currentTask?.split('\n')[0]?.replace(/\s+/g, ' ').trim();
  const head = `${row.agent.name} · ${state} · ${duration}`;
  if (!task || task === row.agent.name || task.length > 120) return head;
  return `${head}. ${task}`;
}

function handoffPath(link: TimelineHandoff): string {
  const x1 = link.fromX * 1000;
  const x2 = link.toX * 1000;
  const y1 = link.fromRow + 0.5;
  const y2 = link.toRow + 0.5;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}
