/**
 * App timestamps: `YYYY-MM-DD HH:MM:SS` in UTC, the shape SQLite's
 * `datetime('now')` writes and every frontend and MCP writer copies.
 *
 * Handed the space-separated form, JavaScript parses it as *local* time, so a
 * reader that forgets the zone puts every age off by the offset (a fresh run
 * lands in the future west of UTC). Reading and writing go through here.
 */
export function formatUtcStamp(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * A stored timestamp as a Date: the UTC form above, or a full ISO string (a row
 * that never reached the database). Null for anything unparseable, so a
 * corrupt row loses its age rather than rendering "NaN" or an epoch date.
 */
export function parseUtcDate(raw: string): Date | null {
  // No zone means UTC, whether the separator is a space or a `T`.
  const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** {@link parseUtcDate} as milliseconds since the epoch. */
export function parseUtcStamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return parseUtcDate(raw)?.getTime() ?? null;
}
