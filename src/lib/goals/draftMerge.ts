/**
 * Field-level merge between the goals draft and the project database.
 *
 * The UI edits a draft of every goal, run and station; the MCP server writes
 * single fields straight to the database. Row-level syncing let a stale draft
 * row put back values an agent had changed (MET-01, mission goal-native 01).
 * These two functions keep the draft to what the person actually edited:
 * `rebaseDraft` moves a draft onto a fresh load, `editedRows` picks what a save
 * has to send, together with the base each edit was made from — the Rust sync
 * then writes only the columns that differ from that base.
 */

interface Identified {
  id: string;
}

/** Value equality for row fields: primitives, and parsed JSON like predicates. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameRow<T extends Identified>(a: T, b: T): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof T>;
  for (const key of keys) if (!sameValue(a[key], b[key])) return false;
  return true;
}

/**
 * Re-applies the draft's own edits on top of `fresh`. A field the draft left
 * equal to `base` takes the fresh value; a field the draft changed keeps it.
 * A row that was in `base` but is gone from `fresh` was deleted elsewhere and
 * is dropped — a deletion wins over an edit made to a row that no longer
 * exists. A row neither in `base` nor in the draft was created elsewhere and
 * is added; one in `base` but not in the draft was deleted here and stays out.
 */
export function rebaseDraft<T extends Identified>(draft: T[], base: T[], fresh: T[]): T[] {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const freshById = new Map(fresh.map((r) => [r.id, r]));
  const out: T[] = [];
  for (const row of draft) {
    const was = baseById.get(row.id);
    const now = freshById.get(row.id);
    if (!was) {
      out.push(now && sameRow(row, now) ? now : row);
      continue;
    }
    if (!now) continue;
    const merged = { ...now };
    const keys = new Set([...Object.keys(row), ...Object.keys(was)]) as Set<keyof T>;
    for (const key of keys) {
      if (!sameValue(row[key], was[key])) merged[key] = row[key];
    }
    out.push(merged);
  }
  const inDraft = new Set(draft.map((r) => r.id));
  for (const row of fresh) {
    if (!inDraft.has(row.id) && !baseById.has(row.id)) out.push(row);
  }
  return out;
}

/** Bookkeeping that every edit rewrites on either side: never a clash. */
const NEVER_CLASHES = new Set(['updatedAt']);

/**
 * The rows where the draft and `fresh` changed the same field away from `base`
 * to different values: an edit the person made and one an agent made, neither
 * having seen the other. `rebaseDraft` keeps the person's value; the caller has
 * to keep `base` for these rows too, or the next save would treat the agent's
 * value as seen and overwrite it. Mirrors the clash test in `goals_sync_impl`.
 */
export function findClashes<T extends Identified>(
  draft: T[],
  base: T[],
  fresh: T[]
): { id: string; columns: string[] }[] {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const freshById = new Map(fresh.map((r) => [r.id, r]));
  const clashes: { id: string; columns: string[] }[] = [];
  for (const row of draft) {
    const was = baseById.get(row.id);
    const now = freshById.get(row.id);
    if (!was || !now) continue;
    const keys = new Set([...Object.keys(row), ...Object.keys(was)]) as Set<keyof T & string>;
    const columns = [...keys]
      .filter((key) => !NEVER_CLASHES.has(key))
      .filter(
        (key) =>
          !sameValue(row[key], was[key]) &&
          !sameValue(now[key], was[key]) &&
          !sameValue(now[key], row[key])
      )
      .sort();
    if (columns.length > 0) clashes.push({ id: row.id, columns });
  }
  return clashes;
}

/** The rows a save must send: new ones, and edited ones with their base. */
export function editedRows<T extends Identified>(draft: T[], base: T[]): { rows: T[]; bases: T[] } {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const rows: T[] = [];
  const bases: T[] = [];
  for (const row of draft) {
    const was = baseById.get(row.id);
    if (!was) {
      rows.push(row);
    } else if (!sameRow(row, was)) {
      rows.push(row);
      bases.push(was);
    }
  }
  return { rows, bases };
}
