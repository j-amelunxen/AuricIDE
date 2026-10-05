'use client';

import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import Image from 'next/image';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { GoalLine, LineStation } from '@/lib/goals/goalLinesLayout';
import {
  stationStatusText,
  timelineRows,
  type FoldGroup,
  type TimelineRow,
} from '@/lib/goals/goalLineTimeline';

export interface GoalLineTimelineProps {
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  /** Ticks a human step off. */
  onTick: (stationId: string) => void;
  /** Moves a station to an index; the done-work clamp lives in stationOrder. */
  onMove: (goalId: string, stationId: string, toIndex: number) => void;
  /** Runs the machine check for a station with a checkable predicate. */
  onVerify: (stationId: string) => void;
  /** Records a decision not to do a station; the reason is required. */
  onSkip: (stationId: string, reason: string) => void;
  /** Adds a human step to this line — one line of typing, nothing more. */
  onQuickAdd: (goalId: string, name: string) => void;
  onReset: (goalId: string) => void;
}

const AMBER = '#ffce2e';
const GREEN = '#2effa5';
const RED = '#ff4a4a';

const FOLD_LABEL: Record<FoldGroup, { closed: (n: number) => string; open: string }> = {
  done: { closed: (n) => `${n} more done`, open: 'Hide earlier steps' },
  skipped: { closed: (n) => `${n} skipped`, open: 'Hide skipped steps' },
  later: { closed: (n) => `${n} more planned`, open: 'Hide later steps' },
};

function sourceImageUrl(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    // Browser/test mode has no Tauri protocol bridge.
    return path;
  }
}

/** A done station whose evidence is weak or old: shown in amber, offered a check. */
function needsLook(station: LineStation): boolean {
  return station.state === 'done' && (station.evidence === 'claim' || station.stale === true);
}

/**
 * The marker on the rail. Four shapes, no legend: ✓ done, ◉ now, ○ ahead,
 * ◆ a person's step. Colour only ever says status — the line's hue for
 * done work, amber where a look or a person is needed.
 */
function RailMarker({ station, hue }: { station: LineStation; hue: string }) {
  if (station.kind === 'terminus') {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 items-center justify-center rounded-[4px] text-[9px] font-bold text-background-dark"
        style={{ backgroundColor: station.state === 'done' ? hue : 'rgba(255,255,255,0.25)' }}
      >
        ⚑
      </span>
    );
  }
  if (station.kind === 'human' && station.state !== 'done') {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rotate-45 rounded-[2px]"
        style={{ backgroundColor: AMBER }}
      />
    );
  }
  if (station.state === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-background-dark"
        style={{ backgroundColor: needsLook(station) ? AMBER : hue }}
      >
        ✓
      </span>
    );
  }
  if (station.state === 'skipped') {
    return (
      <span aria-hidden="true" className="text-[11px] text-foreground-muted">
        ↷
      </span>
    );
  }
  if (station.state === 'front') {
    return (
      <span
        aria-hidden="true"
        className="relative flex h-4 w-4 items-center justify-center rounded-full"
      >
        <span
          className="goal-line-breathe absolute inset-0 rounded-full opacity-40"
          style={{ backgroundColor: hue }}
        />
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hue }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 rounded-full border-2 ${station.state === 'fog' ? 'border-white/15' : 'border-white/35'}`}
    />
  );
}

function AgentChips({
  station,
  agentsById,
}: {
  station: LineStation;
  agentsById: Map<string, AgentInfo>;
}) {
  const agents = station.agentIds
    .map((id) => agentsById.get(id))
    .filter((a): a is AgentInfo => a !== undefined);
  if (agents.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {agents.map((agent) => {
        const failed = agent.status === 'error';
        const color = failed ? RED : agent.awaitingInput ? AMBER : GREEN;
        return (
          <span
            key={agent.id}
            data-testid={`perched-agent-${agent.id}`}
            className="flex items-center gap-1 text-[10px] font-semibold"
            style={{ color }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            {failed
              ? `${agent.name} failed`
              : agent.awaitingInput
                ? `${agent.name} needs input`
                : agent.name}
          </span>
        );
      })}
    </span>
  );
}

function StationSource({ station }: { station: LineStation }) {
  const source = station.sourceContext;
  if (!source) return null;
  return (
    <div
      data-testid={`station-source-detail-${station.id}`}
      className="border-t border-white/5 pt-2 text-[10px] leading-relaxed text-foreground-muted"
    >
      {source.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {source.transcriptSegments.map((segment) => (
        <blockquote
          key={`${segment.startMs}-${segment.endMs}`}
          className="mt-1.5 border-l border-white/10 pl-2"
        >
          <span className="mr-2 font-mono text-[9px] text-foreground-muted/50">
            {Math.floor(segment.startMs / 1000)}s
          </span>
          {segment.text}
        </blockquote>
      ))}
      {source.frames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {source.frames.map((frame) => (
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
              <figcaption className="px-2 py-1 font-mono text-[9px]">
                @{Math.round(frame.timestampMs / 1000)}s
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="mt-2 break-all font-mono text-[9px] text-foreground-muted/40">
        import {source.importId}
      </p>
    </div>
  );
}

const ACTION =
  'rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/70 active:scale-[0.97]';

interface StationRowProps {
  station: LineStation;
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  /** Position among the line's own stations, for reorder targets. */
  index: number;
  expanded: boolean;
  onToggle: () => void;
  actions: Pick<GoalLineTimelineProps, 'onTick' | 'onMove' | 'onVerify' | 'onSkip'>;
}

function StationRow({
  station,
  line,
  agentsById,
  index,
  expanded,
  onToggle,
  actions,
}: StationRowProps) {
  const [skipReason, setSkipReason] = useState<string | null>(null);
  const isTerminus = station.kind === 'terminus';
  const pending = station.state !== 'done' && station.state !== 'skipped';
  const humanOpen = station.kind === 'human' && pending;
  const status = isTerminus
    ? line.satisfied
      ? 'all conditions met'
      : null
    : stationStatusText(station);
  const look = needsLook(station);
  const canReorder = line.planCommitted && pending && !isTerminus;
  const canSkip = line.planCommitted && station.kind === 'normal' && pending;
  // Detail the status line does not already say: a skip's reason is the status.
  const detail = station.state === 'skipped' ? undefined : station.detail;
  const hasMore =
    !isTerminus &&
    (Boolean(detail) ||
      Boolean(station.sourceContext) ||
      canReorder ||
      canSkip ||
      station.checkable);

  const commitSkip = () => {
    const reason = skipReason?.trim() ?? '';
    if (!reason) return;
    actions.onSkip(station.id, reason);
    setSkipReason(null);
  };

  return (
    <li
      data-testid={`station-row-${station.id}`}
      className={`relative flex gap-3 pb-3 ${station.state === 'fog' ? 'opacity-50' : ''}`}
    >
      <span className="relative z-10 flex h-5 w-4 flex-none items-center justify-center bg-background-dark">
        <RailMarker station={station} hue={line.hue} />
      </span>
      <div
        className={`min-w-0 flex-1 rounded-xl ${
          station.state === 'front' ? 'bg-white/[0.04] px-3 py-2 -mt-1.5' : ''
        }`}
      >
        <div className="flex items-start gap-2">
          <button
            data-testid={`station-toggle-${station.id}`}
            aria-expanded={hasMore ? expanded : undefined}
            disabled={!hasMore}
            onClick={onToggle}
            className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-default"
          >
            <span
              className={`text-[12px] leading-5 ${
                station.state === 'front'
                  ? 'font-semibold text-foreground'
                  : station.state === 'done' || station.state === 'skipped'
                    ? 'text-foreground-muted'
                    : 'text-foreground/90'
              }`}
            >
              {isTerminus ? (line.satisfied ? 'Goal reached' : 'Goal') : station.label}
            </span>
            {status && (
              <span
                data-testid={`station-status-${station.id}`}
                className="text-[10px]"
                style={{ color: look || humanOpen ? AMBER : undefined }}
              >
                <span className={look || humanOpen ? '' : 'text-foreground-muted/70'}>
                  {status}
                </span>
              </span>
            )}
          </button>
          <span className="flex flex-none items-center gap-1.5">
            {humanOpen && (
              <button
                data-testid={`station-tick-${station.id}`}
                onClick={() => actions.onTick(station.id)}
                className={`${ACTION} bg-white/10 text-foreground`}
              >
                Done
              </button>
            )}
            {look && station.checkable && (
              <button
                data-testid={`station-verify-${station.id}`}
                onClick={() => actions.onVerify(station.id)}
                className={ACTION}
              >
                Verify
              </button>
            )}
          </span>
        </div>
        {station.state === 'front' && (
          <div className="mt-1">
            <AgentChips station={station} agentsById={agentsById} />
          </div>
        )}
        {expanded && hasMore && (
          <div
            data-testid={`station-detail-${station.id}`}
            className="mt-2 flex flex-col gap-2 rounded-xl bg-white/[0.03] p-3"
          >
            {detail && <p className="text-[11px] text-foreground-muted">{detail}</p>}
            <StationSource station={station} />
            <div className="flex flex-wrap items-center gap-1.5">
              {station.checkable && !look && (
                <button
                  data-testid={`station-verify-${station.id}`}
                  onClick={() => actions.onVerify(station.id)}
                  className={ACTION}
                >
                  Verify
                </button>
              )}
              {canReorder && (
                <>
                  <button
                    data-testid={`station-up-${station.id}`}
                    aria-label={`Move "${station.label}" earlier`}
                    onClick={() => actions.onMove(line.goalId, station.id, index - 1)}
                    className={ACTION}
                  >
                    ↑ Earlier
                  </button>
                  <button
                    data-testid={`station-down-${station.id}`}
                    aria-label={`Move "${station.label}" later`}
                    onClick={() => actions.onMove(line.goalId, station.id, index + 1)}
                    className={ACTION}
                  >
                    ↓ Later
                  </button>
                </>
              )}
              {canSkip && skipReason === null && (
                <button
                  data-testid={`station-skip-${station.id}`}
                  onClick={() => setSkipReason('')}
                  className={ACTION}
                >
                  Skip…
                </button>
              )}
            </div>
            {canSkip && skipReason !== null && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  data-testid={`station-skip-reason-${station.id}`}
                  autoFocus
                  aria-label={`Why skip "${station.label}"?`}
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSkip();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setSkipReason(null);
                    }
                  }}
                  placeholder="Why is this step not needed?"
                  className="min-w-[200px] flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground-muted/40 focus-visible:ring-2 focus-visible:ring-primary/70"
                />
                <button
                  data-testid={`station-skip-confirm-${station.id}`}
                  aria-disabled={skipReason.trim() === ''}
                  onClick={commitSkip}
                  className={`${ACTION} aria-disabled:cursor-not-allowed aria-disabled:opacity-40`}
                >
                  Skip step
                </button>
                <button onClick={() => setSkipReason(null)} className={ACTION}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function FoldRow({ row, onToggle }: { row: TimelineRow & { type: 'fold' }; onToggle: () => void }) {
  return (
    <li className="relative flex gap-3 pb-3">
      <span className="relative z-10 flex h-5 w-4 flex-none items-center justify-center bg-background-dark text-[10px] text-foreground-muted/60">
        ⋮
      </span>
      <button
        data-testid={`timeline-fold-${row.group}`}
        aria-expanded={row.open}
        onClick={onToggle}
        className="rounded-md text-[11px] text-foreground-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        {row.open ? FOLD_LABEL[row.group].open : FOLD_LABEL[row.group].closed(row.count)}
        <span aria-hidden="true" className="ml-1">
          {row.open ? '▴' : '▾'}
        </span>
      </button>
    </li>
  );
}

function ResetPlan({
  line,
  agentsById,
  onReset,
}: {
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  onReset: (goalId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const blocked = line.stations
    .flatMap((station) => station.agentIds)
    .some((id) => {
      const status = agentsById.get(id)?.status;
      return status === 'running' || status === 'queued';
    });
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
      wasConfirming.current = true;
    } else if (wasConfirming.current) {
      resetRef.current?.focus();
      wasConfirming.current = false;
    }
  }, [confirming]);

  if (confirming) {
    return (
      <span
        className="flex flex-wrap items-center gap-1 text-[10px] text-foreground-muted"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setConfirming(false);
          }
        }}
      >
        Remove all steps? The goal remains a draft.
        <button
          data-testid={`goal-line-reset-confirm-${line.goalId}`}
          onClick={() => onReset(line.goalId)}
          className="min-h-6 min-w-6 rounded-md bg-[#ff4a4a]/15 px-2 py-1 font-semibold text-[#ff8a8a] focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          Reset plan
        </button>
        <button
          ref={cancelRef}
          data-testid={`goal-line-reset-cancel-${line.goalId}`}
          onClick={() => setConfirming(false)}
          className="min-h-6 rounded-md px-2 py-1 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary/70"
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <>
      <button
        ref={resetRef}
        data-testid={`goal-line-reset-${line.goalId}`}
        aria-disabled={blocked}
        aria-describedby={blocked ? `goal-line-reset-blocked-${line.goalId}` : undefined}
        title={blocked ? 'Wait until the assigned agent is no longer running.' : 'Reset this plan'}
        onClick={() => {
          if (!blocked) setConfirming(true);
        }}
        className="min-h-6 rounded-lg px-2 text-[10px] text-[#ff8a8a] hover:bg-[#ff4a4a]/10 focus-visible:ring-2 focus-visible:ring-primary/70 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
      >
        Reset plan
      </button>
      {blocked && (
        <span
          id={`goal-line-reset-blocked-${line.goalId}`}
          data-testid={`goal-line-reset-blocked-${line.goalId}`}
          className="basis-full text-[10px] text-foreground-muted"
        >
          An assigned agent is still running. Reset is available once it stops.
        </span>
      )}
    </>
  );
}

/**
 * The line as a vertical timeline, top to bottom in the order the work runs.
 * The past folds down to its last steps (plus anything that still needs a
 * look), the front is highlighted with the agents on it, the next few
 * stations follow and the rest folds. Each row says in words how sure it
 * is, and a click opens its actions in place.
 */
export function GoalLineTimeline({
  line,
  agentsById,
  onTick,
  onMove,
  onVerify,
  onSkip,
  onQuickAdd,
  onReset,
}: GoalLineTimelineProps) {
  const [openFolds, setOpenFolds] = useState<Set<FoldGroup>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState('');
  const rows = timelineRows(line, openFolds);
  const ownIds = line.stations.filter((s) => s.kind !== 'terminus').map((s) => s.id);
  const actions = { onTick, onMove, onVerify, onSkip };

  const toggleFold = (group: FoldGroup) =>
    setOpenFolds((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const commitQuickAdd = () => {
    const name = quickAdd.trim();
    if (!name) return;
    onQuickAdd(line.goalId, name);
    setQuickAdd('');
  };

  return (
    <div className="flex flex-col gap-4">
      <ol data-testid={`goal-line-timeline-${line.goalId}`} className="relative">
        <span
          aria-hidden="true"
          className="absolute bottom-4 left-2 top-2 w-px -translate-x-1/2 bg-white/10"
        />
        {rows.map((row) =>
          row.type === 'fold' ? (
            <FoldRow key={`fold-${row.group}`} row={row} onToggle={() => toggleFold(row.group)} />
          ) : (
            <StationRow
              key={row.station.id}
              station={row.station}
              line={line}
              agentsById={agentsById}
              index={ownIds.indexOf(row.station.id)}
              expanded={expandedId === row.station.id}
              onToggle={() =>
                setExpandedId((current) => (current === row.station.id ? null : row.station.id))
              }
              actions={actions}
            />
          )
        )}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        <input
          data-testid={`goal-line-quick-add-${line.goalId}`}
          type="text"
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitQuickAdd();
          }}
          aria-label="Add a step for you"
          placeholder="+ Add a step for you, then press Enter"
          className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none transition-colors placeholder:text-foreground-muted/40 focus:bg-black/50 focus-visible:ring-2 focus-visible:ring-primary/70"
        />
        {line.planCommitted && <ResetPlan line={line} agentsById={agentsById} onReset={onReset} />}
      </div>
    </div>
  );
}
