'use client';

import type { ConsoleAgentState } from '@/lib/agents/consoleState';

/**
 * The tone a heartbeat line reads in — one per phase family the console
 * shows, not per exact `AgentPhase`: waiting/failed carry their own colour,
 * everything else in-progress reads as "running", and a stopped agent reads
 * as "done". Kept separate from `AgentPhase` so a caller with just the
 * console's phase chip class can hand this whichever bucket it already computed.
 */
export type HeartbeatTone = 'running' | 'waiting' | 'stalled' | 'done' | 'failed';

/**
 * `ConsoleAgentState` → the heartbeat tone it reads in, one map shared by
 * every place a console state needs a sparkline colour — the fleet card and
 * the focus view's stage and rail all draw from this, so a phase can never
 * pulse a different colour depending on which of them is showing it.
 */
export const CONSOLE_STATE_HEARTBEAT_TONE: Record<ConsoleAgentState, HeartbeatTone> = {
  yours: 'waiting',
  error: 'failed',
  stalled: 'stalled',
  working: 'running',
  done: 'done',
};

const STROKE: Record<HeartbeatTone, string> = {
  running: 'var(--color-emerald-400, #34d399)',
  waiting: 'var(--color-amber-400, #fbbf24)',
  stalled: 'var(--color-amber-400, #fbbf24)',
  done: 'var(--color-primary-light, #6ae5ff)',
  failed: 'var(--color-red-400, #f87171)',
};

const WIDTH = 84;
const HEIGHT = 22;
const PAD = 2;

export interface HeartbeatProps {
  /** Output volume per minute, oldest first — see `heartbeatSeries`. */
  values: number[];
  tone: HeartbeatTone;
  className?: string;
}

/**
 * A fleet-wide glance at an agent's output volume: 24 trailing samples as a
 * tiny filled sparkline, coloured by the same tone as its phase chip.
 */
export function Heartbeat({ values, tone, className = '' }: HeartbeatProps) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (WIDTH - 2 * PAD) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = PAD + i * step;
      const y = HEIGHT - PAD - (v / max) * (HEIGHT - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const stroke = STROKE[tone];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Output activity, last 24 minutes"
      className={className}
    >
      <polyline
        data-testid="heartbeat-line"
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
