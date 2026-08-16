'use client';

import type { ConsoleAgentState } from '@/lib/agents/consoleState';
import {
  HEARTBEAT_BANDS,
  heartbeatLatest,
  type HeartbeatBand,
  type HeartbeatSample,
} from '@/lib/agents/events/heartbeat';

/**
 * The tone a heartbeat reads in — one per phase family the console shows, not
 * per exact `AgentPhase`: waiting/failed carry their own colour, everything
 * else in-progress reads as "running", and a stopped agent reads as "done".
 */
export type HeartbeatTone = 'running' | 'waiting' | 'stalled' | 'done' | 'failed';

/**
 * `ConsoleAgentState` → the heartbeat tone it reads in, one map shared by
 * every place a console state needs a chart colour — the fleet card and the
 * focus view's stage and rail all draw from this, so a phase can never pulse
 * a different colour depending on which of them is showing it.
 */
export const CONSOLE_STATE_HEARTBEAT_TONE: Record<ConsoleAgentState, HeartbeatTone> = {
  yours: 'waiting',
  error: 'failed',
  stalled: 'stalled',
  working: 'running',
  done: 'done',
};

/**
 * The band colours. Only used while an agent is working — once it is waiting,
 * stalled, failed or done, the whole chart drops to the state's single tone,
 * because at that point *what* it was doing matters far less than the fact
 * that it stopped.
 */
const BAND_FILL: Record<HeartbeatBand, string> = {
  edit: 'var(--color-primary-light, #6ae5ff)',
  run: 'var(--color-emerald-400, #34d399)',
  ask: 'var(--color-amber-400, #fbbf24)',
  read: 'rgba(148, 163, 184, 0.75)',
};

const TONE_FILL: Record<HeartbeatTone, string> = {
  running: 'var(--color-emerald-400, #34d399)',
  waiting: 'var(--color-amber-400, #fbbf24)',
  stalled: 'var(--color-amber-400, #fbbf24)',
  done: 'var(--color-primary-light, #6ae5ff)',
  failed: 'var(--color-red-400, #f87171)',
};

const WIDTH = 84;
const HEIGHT = 22;
const GAP = 1;

export interface HeartbeatProps {
  /** 24 trailing per-minute samples, oldest first — see `heartbeatSeries`. */
  samples: HeartbeatSample[];
  /**
   * The tallest minute anywhere in the fleet — see `fleetHeartbeatMax`. Every
   * card must be handed the same number: a chart normalised to its own peak
   * draws a quiet agent and a frantic one identically, which is what made the
   * old sparkline unreadable.
   */
  scaleMax: number;
  tone: HeartbeatTone;
  className?: string;
}

/** "3 edits, 1 question" — the plain-language reading of one minute. */
function describeSample(sample: HeartbeatSample): string {
  const parts = HEARTBEAT_BANDS.filter((band) => (sample.counts[band] ?? 0) > 0).map((band) => {
    const n = sample.counts[band] ?? 0;
    const noun = { edit: 'edit', run: 'command', ask: 'question', read: 'look' }[band];
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  });
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/**
 * A fleet-wide glance at what an agent has been doing: 24 trailing minutes as
 * stacked bars, one band per kind of work, drawn against a scale shared by
 * every card so two of them can honestly be compared.
 */
export function Heartbeat({ samples, scaleMax, tone, className = '' }: HeartbeatProps) {
  const max = Math.max(1, scaleMax);
  const slot = samples.length > 0 ? WIDTH / samples.length : WIDTH;
  const barWidth = Math.max(1, slot - GAP);
  const working = tone === 'running';
  const latest = heartbeatLatest(samples);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`Activity over the last ${samples.length} minutes, ${latest} in the last minute`}
        className="block"
      >
        {samples.map((sample, i) => {
          const x = i * slot;
          // Stack the bands bottom-up so the same kind of work always sits at
          // the same height, and a column can be read without a legend.
          let y = HEIGHT;
          return (
            <g key={i}>
              <title>{describeSample(sample)}</title>
              {HEARTBEAT_BANDS.map((band) => {
                const count = sample.counts[band] ?? 0;
                if (count === 0) return null;
                const h = (count / max) * HEIGHT;
                y -= h;
                return (
                  <rect
                    key={band}
                    data-testid={`heartbeat-bar-${band}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={h}
                    fill={working ? BAND_FILL[band] : TONE_FILL[tone]}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* The number the old chart never showed. Without it a shape is just a
          shape — there was no way to tell one event from a hundred. */}
      <span
        data-testid="heartbeat-latest"
        className="w-6 shrink-0 font-mono text-[10px] tabular-nums text-foreground-muted"
        title="Events in the last minute"
      >
        {latest > 0 ? latest : '—'}
      </span>
    </div>
  );
}
