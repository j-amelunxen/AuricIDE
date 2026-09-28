/**
 * Keeping store references stable across reloads.
 *
 * A reload from IPC delivers fresh objects every time, so writing them
 * straight into the store tells every subscriber that everything changed —
 * and a page-level selector re-renders the whole IDE. These helpers keep the
 * previous reference wherever the value did not actually change.
 */

/**
 * Structural equality for the plain-JSON values IPC returns. A refresh
 * delivers fresh objects every time, so reference checks alone would call
 * every refresh a change.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

interface Row {
  id: string;
}

function isRowArray(value: unknown): value is Row[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'object' && v !== null && typeof v.id === 'string')
  );
}

/**
 * `next`, except that every row structurally equal to the row with the same id
 * in `prev` is `prev`'s object. When nothing differs at all, `prev` itself —
 * so a reload that brings nothing new changes no reference anywhere.
 */
export function reuseRows<T extends Row>(prev: readonly T[], next: T[]): T[] {
  const byId = new Map(prev.map((row) => [row.id, row]));
  let changed = prev.length !== next.length;
  const out = next.map((row, i) => {
    const old = byId.get(row.id);
    if (old !== undefined && sameValue(old, row)) {
      if (prev[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return row;
  });
  return changed ? out : (prev as T[]);
}

/**
 * The part of `next` that differs from `current`, ready for `set`. Arrays of
 * rows keep their unchanged rows by reference; everything else is compared as
 * a whole value. An empty result means the write can be skipped.
 */
export function changedFields<S extends object>(current: S, next: Partial<S>): Partial<S> {
  const patch: Partial<S> = {};
  for (const key of Object.keys(next) as (keyof S)[]) {
    const was = current[key];
    const now = next[key] as S[keyof S];
    const kept = isRowArray(was) && isRowArray(now) ? (reuseRows(was, now) as S[keyof S]) : now;
    if (kept === was || sameValue(was, kept)) continue;
    patch[key] = kept;
  }
  return patch;
}

/** `set` with only the fields that really changed; no call at all when none did. */
export function writeChanged<S extends object>(
  set: (patch: Partial<S>) => void,
  current: S,
  next: Partial<S>
): void {
  const patch = changedFields(current, next);
  if (Object.keys(patch).length > 0) set(patch);
}
