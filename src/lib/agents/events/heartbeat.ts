/** One minute's worth of output volume for an agent. */
export interface HeartbeatBucket {
  /** `Math.floor(at / 60_000)` — a stable, comparable minute index. */
  minute: number;
  bytes: number;
}

/** How many trailing one-minute buckets a heartbeat retains. */
export const HEARTBEAT_WINDOW_MINUTES = 24;

/**
 * Folds a chunk's byte count into the current minute's bucket, opening a new
 * one when the minute has rolled over, and drops buckets older than the
 * retention window. Immutable — callers keep the previous array.
 */
export function pushHeartbeat(
  buckets: HeartbeatBucket[],
  bytes: number,
  at: number
): HeartbeatBucket[] {
  const minute = Math.floor(at / 60_000);
  const last = buckets[buckets.length - 1];

  const updated =
    last && last.minute === minute
      ? [...buckets.slice(0, -1), { minute, bytes: last.bytes + bytes }]
      : [...buckets, { minute, bytes }];

  return updated.slice(-HEARTBEAT_WINDOW_MINUTES);
}

/**
 * The last 24 minutes of output volume as a fixed-length series, oldest
 * first, with gaps (no output that minute) filled in as zero — what a
 * sparkline renders directly.
 */
export function heartbeatSeries(buckets: HeartbeatBucket[], now: number): number[] {
  const nowMinute = Math.floor(now / 60_000);
  const byMinute = new Map(buckets.map((bucket) => [bucket.minute, bucket.bytes]));

  return Array.from({ length: HEARTBEAT_WINDOW_MINUTES }, (_, i) => {
    const minute = nowMinute - (HEARTBEAT_WINDOW_MINUTES - 1 - i);
    return byMinute.get(minute) ?? 0;
  });
}
