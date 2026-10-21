/**
 * Which match ⌘G / ⇧⌘G lands on. `positions` are the matches' row indexes in
 * row order; `from` is the selected row (-1 when none). Wraps at both ends.
 */
export function steppedMatchIndex(
  positions: number[],
  from: number,
  direction: 1 | -1
): number | null {
  if (positions.length === 0) return null;
  if (direction === 1) {
    const next = positions.findIndex((p) => p > from);
    return next === -1 ? 0 : next;
  }
  for (let i = positions.length - 1; i >= 0; i -= 1) if (positions[i] < from) return i;
  return positions.length - 1;
}
