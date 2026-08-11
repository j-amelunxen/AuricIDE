'use client';

import { useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { GoalLine, LineStation } from '@/lib/goals/goalLinesLayout';
import { formatAgentDuration } from '@/lib/agents/duration';
import { GoalLineMap } from './GoalLineMap';
import { convertFileSrc } from '@tauri-apps/api/core';
import Image from 'next/image';

export interface GoalLineCardProps {
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  now: number;
  onOpen: (goalId: string) => void;
  /** Adds a human step to this line — one line of typing, nothing more. */
  onQuickAdd: (goalId: string, name: string) => void;
  /** Ticks a human step off. Only rendered on committed plans. */
  onTick: (stationId: string) => void;
  /** Moves a station to an index; the done-work clamp lives in stationOrder. */
  onMove: (goalId: string, stationId: string, toIndex: number) => void;
  /** Runs the machine check for a station with a checkable predicate. */
  onVerify: (stationId: string) => void;
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

const STATE_GLYPH: Record<LineStation['state'], string> = {
  done: '●',
  front: '◉',
  planned: '○',
  fog: '·',
};

function sourceImageUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    // Browser/test mode has no Tauri protocol bridge.
    return path;
  }
}

/** One goal on the board: name, its line, last / now / next, and — for
 * committed plans — the station rows with reorder and tick controls. */
export function GoalLineCard({
  line,
  agentsById,
  now,
  onOpen,
  onQuickAdd,
  onTick,
  onMove,
  onVerify,
}: GoalLineCardProps) {
  const [quickAdd, setQuickAdd] = useState('');
  const [stationsOpen, setStationsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const flag = lineFlag(line, agentsById, now);
  const runningHere = line.stations.reduce((n, s) => n + s.agentIds.length, 0);

  const nowText = line.now
    ? runningHere > 0
      ? `${runningHere} agent${runningHere === 1 ? '' : 's'} at "${line.now.label}"`
      : `"${line.now.label}" is in progress, no agent on it`
    : 'nothing in progress';
  const nextText = line.next?.label ?? (line.satisfied ? 'goal reached' : 'nothing planned');

  const rows = line.stations.filter((s) => s.kind !== 'terminus');

  const commitQuickAdd = () => {
    const name = quickAdd.trim();
    if (!name) return;
    onQuickAdd(line.goalId, name);
    setQuickAdd('');
  };

  return (
    <div
      data-testid={`goal-line-card-${line.goalId}`}
      className="flex w-full flex-col gap-2 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-[border-color] duration-150 hover:border-white/10"
    >
      <button
        data-testid={`goal-line-open-${line.goalId}`}
        onClick={() => onOpen(line.goalId)}
        className="flex w-full flex-col gap-2 text-left transition-opacity active:opacity-80"
      >
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 flex-none translate-y-px rounded-[3px]"
            style={{ backgroundColor: line.hue }}
          />
          <span className="text-sm font-bold text-foreground">{line.name}</span>
          <span
            className={`ml-auto font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums ${flag.className}`}
          >
            {flag.text}
          </span>
        </div>

        <GoalLineMap
          line={line}
          agentsById={agentsById}
          onStationDrop={
            line.planCommitted
              ? (stationId, toIndex) => onMove(line.goalId, stationId, toIndex)
              : undefined
          }
        />

        <dl className="grid grid-cols-[44px_1fr] gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[11px]">
          <dt className="pt-px font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
            last
          </dt>
          <dd className="text-foreground-muted">{line.lastDone?.label ?? 'nothing yet'}</dd>
          <dt className="pt-px font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
            now
          </dt>
          <dd className="text-foreground">{nowText}</dd>
          <dt className="pt-px font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
            next
          </dt>
          <dd className="text-foreground-muted">{nextText}</dd>
        </dl>
      </button>

      {line.planCommitted && (
        <div className="border-t border-white/5 pt-1.5">
          <button
            data-testid={`goal-line-stations-toggle-${line.goalId}`}
            onClick={() => setStationsOpen((v) => !v)}
            className="font-mono text-[9px] uppercase tracking-[0.16em] text-foreground-muted/60 transition-colors hover:text-foreground-muted"
          >
            {stationsOpen ? '▾' : '▸'} stations ({rows.length})
          </button>
          {stationsOpen && (
            <div className="mt-1 flex flex-col">
              {rows.map((s, i) => (
                <div key={s.id} className={s.state === 'fog' ? 'opacity-40' : ''}>
                  <div
                    data-testid={`station-row-${s.id}`}
                    className="flex items-center gap-2 py-1 text-[11px]"
                  >
                    <span
                      aria-hidden="true"
                      className="w-3 text-center font-mono"
                      style={{ color: s.state === 'done' ? line.hue : '#8a8a9c' }}
                    >
                      {STATE_GLYPH[s.state]}
                    </span>
                    <span
                      className={s.state === 'done' ? 'text-foreground-muted' : 'text-foreground'}
                    >
                      {s.label}
                    </span>
                    {s.detail && (
                      <span className="font-mono text-[9px] text-foreground-muted/60">
                        {s.detail}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      {s.sourceContext && (
                        <button
                          data-testid={`station-source-${s.id}`}
                          aria-expanded={sourceOpen === s.id}
                          onClick={() =>
                            setSourceOpen((current) => (current === s.id ? null : s.id))
                          }
                          title="Source notes / transcript / frames"
                          className="rounded-md px-2 py-0.5 text-[10px] font-semibold text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
                        >
                          source {sourceOpen === s.id ? '▾' : '▸'}
                        </button>
                      )}
                      {s.state !== 'done' && (
                        <>
                          <button
                            data-testid={`station-up-${s.id}`}
                            aria-label={`Move "${s.label}" earlier`}
                            onClick={() => onMove(line.goalId, s.id, i - 1)}
                            className="rounded px-2 py-1 text-foreground-muted/60 transition-colors hover:bg-white/10 hover:text-foreground"
                          >
                            ↑
                          </button>
                          <button
                            data-testid={`station-down-${s.id}`}
                            aria-label={`Move "${s.label}" later`}
                            onClick={() => onMove(line.goalId, s.id, i + 1)}
                            className="rounded px-2 py-1 text-foreground-muted/60 transition-colors hover:bg-white/10 hover:text-foreground"
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {s.checkable && (
                        <button
                          data-testid={`station-verify-${s.id}`}
                          onClick={() => onVerify(s.id)}
                          title="Run check"
                          className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
                        >
                          Verify
                        </button>
                      )}
                      {s.kind === 'human' && s.state !== 'done' && (
                        <button
                          data-testid={`station-tick-${s.id}`}
                          onClick={() => onTick(s.id)}
                          className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-foreground transition-colors hover:bg-white/10"
                        >
                          ✓ Done
                        </button>
                      )}
                    </span>
                  </div>
                  {s.sourceContext && sourceOpen === s.id && (
                    <div
                      data-testid={`station-source-detail-${s.id}`}
                      className="mb-2 ml-5 border-t border-white/5 py-2 text-[10px] leading-relaxed text-foreground-muted"
                    >
                      {s.sourceContext.notes.map((note) => (
                        <p key={note} className="text-foreground-muted">
                          {note}
                        </p>
                      ))}
                      {s.sourceContext.transcriptSegments.map((segment) => (
                        <blockquote
                          key={`${segment.startMs}-${segment.endMs}`}
                          className="mt-1.5 border-l border-white/10 pl-2 text-foreground-muted"
                        >
                          <span className="mr-2 font-mono text-[9px] text-foreground-muted/50">
                            {Math.floor(segment.startMs / 1000)}s
                          </span>
                          {segment.text}
                        </blockquote>
                      ))}
                      {s.sourceContext.frames.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {s.sourceContext.frames.map((frame) => (
                            <figure
                              key={frame.path}
                              className="w-32 overflow-hidden rounded-lg border border-white/10 bg-black/30"
                            >
                              <Image
                                src={sourceImageUrl(frame.path)}
                                alt={`Video source at ${Math.round(frame.timestampMs / 1000)} seconds`}
                                width={256}
                                height={144}
                                unoptimized
                                className="aspect-video w-full object-cover"
                              />
                              <figcaption className="px-2 py-1 font-mono text-[9px] text-foreground-muted">
                                @{Math.round(frame.timestampMs / 1000)}s
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 break-all font-mono text-[9px] text-foreground-muted/40">
                        import {s.sourceContext.importId}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-t border-white/5 pt-2">
        <input
          data-testid={`goal-line-quick-add-${line.goalId}`}
          type="text"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitQuickAdd();
          }}
          placeholder="+ human step: “Call the client”, Enter to add"
          className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none transition-colors placeholder:text-foreground-muted/40 focus:bg-black/50"
        />
      </div>
    </div>
  );
}
