import type { AgentEventKind } from './types';

/**
 * The four things worth telling apart at a glance in an agent's recent
 * history. The raw `AgentEventKind` set is finer than that — `read` and
 * `note` both mean "it is looking around / talking", and separating them
 * would cost a band nobody can distinguish in a 22px sparkline.
 */
export type HeartbeatBand = 'edit' | 'run' | 'ask' | 'read';

export const HEARTBEAT_BANDS: readonly HeartbeatBand[] = ['edit', 'run', 'ask', 'read'];

const KIND_TO_BAND: Record<AgentEventKind, HeartbeatBand> = {
  edit: 'edit',
  run: 'run',
  ask: 'ask',
  // `done` and `error` are one-off punctuation rather than ongoing work, but
  // they still happened in that minute and belong in the total.
  done: 'run',
  error: 'run',
  read: 'read',
  note: 'read',
};

export function heartbeatBandFor(kind: AgentEventKind): HeartbeatBand {
  return KIND_TO_BAND[kind];
}

/** One minute's worth of an agent's activity, counted per band. */
export interface HeartbeatBucket {
  /** `Math.floor(at / 60_000)` — a stable, comparable minute index. */
  minute: number;
  counts: Partial<Record<HeartbeatBand, number>>;
}

/** How many trailing one-minute buckets a heartbeat retains. */
export const HEARTBEAT_WINDOW_MINUTES = 24;

/** One rendered column: the per-band breakdown plus its total. */
export interface HeartbeatSample {
  counts: Partial<Record<HeartbeatBand, number>>;
  total: number;
}

function sum(counts: Partial<Record<HeartbeatBand, number>>): number {
  return HEARTBEAT_BANDS.reduce((acc, band) => acc + (counts[band] ?? 0), 0);
}

/**
 * Folds a batch of event kinds into the current minute's bucket, opening a
 * new one when the minute has rolled over, and drops buckets older than the
 * retention window. Immutable — callers keep the previous array.
 *
 * Counts events rather than output bytes on purpose. Bytes made a agent
 * printing a long file look busier than one making a careful edit, which is
 * the opposite of what the reader needs to know.
 */
export function pushHeartbeat(
  buckets: HeartbeatBucket[],
  kinds: readonly AgentEventKind[],
  at: number
): HeartbeatBucket[] {
  if (kinds.length === 0) return buckets;

  const minute = Math.floor(at / 60_000);
  const last = buckets[buckets.length - 1];
  const base = last && last.minute === minute ? { ...last.counts } : {};

  for (const kind of kinds) {
    const band = heartbeatBandFor(kind);
    base[band] = (base[band] ?? 0) + 1;
  }

  const updated =
    last && last.minute === minute
      ? [...buckets.slice(0, -1), { minute, counts: base }]
      : [...buckets, { minute, counts: base }];

  return updated.slice(-HEARTBEAT_WINDOW_MINUTES);
}

/**
 * The last 24 minutes as a fixed-length series, oldest first, with quiet
 * minutes filled in as empty — what a sparkline renders directly.
 */
export function heartbeatSeries(buckets: HeartbeatBucket[], now: number): HeartbeatSample[] {
  const nowMinute = Math.floor(now / 60_000);
  const byMinute = new Map(buckets.map((bucket) => [bucket.minute, bucket.counts]));

  return Array.from({ length: HEARTBEAT_WINDOW_MINUTES }, (_, i) => {
    const minute = nowMinute - (HEARTBEAT_WINDOW_MINUTES - 1 - i);
    const counts = byMinute.get(minute) ?? {};
    return { counts, total: sum(counts) };
  });
}

/**
 * The tallest minute across a whole fleet — the shared vertical scale every
 * card's sparkline is drawn against.
 *
 * This is the fix for the chart that could not be read: normalising each card
 * to its own maximum made a quiet agent and a frantic one draw the identical
 * shape, so the only honest comparison was none. Never returns 0, so an idle
 * fleet divides by 1 rather than by nothing.
 */
export function fleetHeartbeatMax(series: Iterable<HeartbeatSample[]>): number {
  let max = 1;
  for (const samples of series) {
    for (const sample of samples) {
      if (sample.total > max) max = sample.total;
    }
  }
  return max;
}

/** The busiest single minute in one agent's series — its own peak, for a label. */
export function heartbeatPeak(samples: HeartbeatSample[]): number {
  return samples.reduce((max, s) => (s.total > max ? s.total : max), 0);
}

/** How much happened in the most recent minute — the number shown beside the chart. */
export function heartbeatLatest(samples: HeartbeatSample[]): number {
  return samples.length === 0 ? 0 : samples[samples.length - 1].total;
}
