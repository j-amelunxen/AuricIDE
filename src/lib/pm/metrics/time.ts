// ---------------------------------------------------------------------------
// Time parsing, UTC math, formatting, and statistical helpers
// ---------------------------------------------------------------------------

/**
 * SQLite's `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` in UTC, but JS parses
 * that shape as local time. Differences between two such stamps still come out
 * right, so this only started mattering once durations were measured against
 * the clock — those were off by the machine's offset.
 */
export function parseHistoryTime(value: string): number {
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(value);
  if (sqlite) return Date.parse(`${sqlite[1]}T${sqlite[2]}${sqlite[3] ?? ''}Z`);
  return Date.parse(value);
}

/**
 * The UTC calendar day a timestamp falls on. Walking days by `setDate` moves in
 * local time, which loses an hour at a DST switch and from then on labels every
 * day one short — so day arithmetic here stays in UTC milliseconds throughout.
 */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function startOfUtcDay(ms: number): number {
  return Date.parse(`${utcDay(ms)}T00:00:00Z`);
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return '< 1m';
  if (hours < 1) return `${minutes}m`;
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
