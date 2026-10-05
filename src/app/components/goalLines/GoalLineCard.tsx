'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import type { GoalLine } from '@/lib/goals/goalLinesLayout';
import { humanStationsDue } from '@/lib/goals/forYou';
import { formatAgentDuration } from '@/lib/agents/duration';
import { GoalLineProgress } from './GoalLineProgress';

export interface GoalLineCardProps {
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  now: number;
  onOpen: (goalId: string) => void;
  /** Ticks the human step that is due right now off, without opening the line. */
  onTick: (stationId: string) => void;
}

interface LineFlag {
  text: string;
  className: string;
}

/**
 * The card's one-glance verdict, ranked the same way attention is
 * everywhere else: failure beats waiting beats working beats idle.
 */
function lineFlag(line: GoalLine, agentsById: Map<string, AgentInfo>, now: number): LineFlag {
  const perched = line.stations
    .flatMap((s) => s.agentIds)
    .map((id) => agentsById.get(id))
    .filter((a): a is AgentInfo => a !== undefined);
  if (perched.some((a) => a.status === 'error')) {
    return { text: '● failed', className: 'text-[#ff4a4a]' };
  }
  if (perched.some((a) => a.awaitingInput)) {
    return { text: '△ needs you', className: 'text-[#ffce2e]' };
  }
  if (perched.length > 0) {
    return {
      text: `◐ ${perched.length} agent${perched.length === 1 ? '' : 's'}`,
      className: 'text-[#2effa5]',
    };
  }
  if (line.satisfied) {
    return { text: '✓ satisfied', className: 'text-[#2effa5]' };
  }
  const age = line.idleSince !== undefined ? ` · ${formatAgentDuration(now - line.idleSince)}` : '';
  return { text: `○ idle${age}`, className: 'text-foreground-muted' };
}

/**
 * One goal on the board, read like a parcel tracker: how far along it is,
 * what runs now, what comes next, and — only when it is true — the step that
 * waits for you. Everything else (every station, reordering, skipping,
 * adding steps, resetting) lives one click deeper, in the line's timeline.
 */
export function GoalLineCard({ line, agentsById, now, onOpen, onTick }: GoalLineCardProps) {
  const flag = lineFlag(line, agentsById, now);
  const runningHere = line.stations.reduce((n, s) => n + s.agentIds.length, 0);
  const due = humanStationsDue(line.stations);

  return (
    <div
      data-testid={`goal-line-card-${line.goalId}`}
      className="flex w-full flex-col rounded-2xl border border-white/5 bg-white/[0.02] transition-[border-color] duration-150 hover:border-white/10"
    >
      <button
        data-testid={`goal-line-open-${line.goalId}`}
        onClick={() => onOpen(line.goalId)}
        className="flex w-full flex-col gap-3 rounded-2xl p-4 text-left transition-opacity focus-visible:ring-2 focus-visible:ring-primary/70 active:opacity-80"
      >
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 flex-none translate-y-px rounded-[3px]"
            style={{ backgroundColor: line.hue }}
          />
          <span className="truncate text-sm font-bold text-foreground">{line.name}</span>
          <span
            className={`ml-auto flex-none font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums ${flag.className}`}
          >
            {flag.text}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <GoalLineProgress line={line} />
          {line.progress.total > 0 && (
            <span
              data-testid={`goal-line-progress-${line.goalId}`}
              title={
                line.workMode === 'stations'
                  ? 'Stations with verified evidence, across the goal and its sub-goals'
                  : 'Done tickets, across the goal and its sub-goals'
              }
              className="text-[11px] text-foreground-muted tabular-nums"
            >
              {`${line.progress.done} of ${line.progress.total} ${line.progress.unit}${
                line.progress.skipped ? ` · ${line.progress.skipped} skipped` : ''
              }`}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-[48px_1fr] items-baseline gap-x-3 gap-y-1.5">
          <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
            now
          </dt>
          <dd
            data-testid={`goal-line-now-${line.goalId}`}
            className="flex min-w-0 items-baseline gap-2"
          >
            <span className="truncate text-[13px] font-semibold text-foreground">
              {line.now?.label ?? (line.satisfied ? 'Goal reached' : 'Nothing in progress')}
            </span>
            {line.now && runningHere > 0 && (
              <span className="flex flex-none items-center gap-1 text-[10px] font-semibold text-[#2effa5]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#2effa5]" />
                {runningHere} agent{runningHere === 1 ? '' : 's'}
              </span>
            )}
            {line.now && runningHere === 0 && line.now.kind !== 'human' && (
              <span className="flex-none text-[10px] text-foreground-muted">no agent on it</span>
            )}
          </dd>
          {line.next && (
            <>
              <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
                next
              </dt>
              <dd className="truncate text-[11px] text-foreground-muted">{line.next.label}</dd>
            </>
          )}
        </dl>
      </button>

      {due.length > 0 && (
        <div
          data-testid={`goal-line-needs-you-${line.goalId}`}
          className="mx-4 mb-4 flex items-center gap-2 rounded-xl bg-[#ffce2e]/[0.07] px-3 py-2"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 flex-none rotate-45 rounded-[1px] bg-[#ffce2e]"
          />
          <span className="min-w-0 flex-1 text-[11px] text-foreground">
            <span className="font-semibold text-[#ffce2e]">Needs you: </span>
            {due[0].label}
            {due.length > 1 && (
              <span className="text-foreground-muted"> · {due.length - 1} more</span>
            )}
          </span>
          <button
            data-testid={`goal-line-tick-due-${due[0].id}`}
            onClick={() => onTick(due[0].id)}
            className="flex-none rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-primary/70 active:scale-[0.97]"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
