/** One entry of the rendered explorer list: a real row, or the space of the rows skipped. */
export type RowPlanEntry =
  { kind: 'row'; index: number } | { kind: 'gap'; start: number; height: number };

interface PlanInput {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  /** Rows rendered beyond each edge of the viewport. */
  overscan: number;
  /** Rows that must stay mounted wherever they are — focus, an active drag. */
  pinned: readonly number[];
}

/**
 * Which rows of a fixed-row-height list to mount, in list order, with the
 * skipped stretches collapsed into gaps of exactly their height.
 *
 * Gaps rather than absolute positioning keep every mounted row in normal
 * flow at the offset it would have with the whole list rendered, so the
 * browser's own behaviour — focus scrolling a row into view, scroll
 * anchoring, the rows' box-shadow glow painting over their neighbours — is
 * what it was before the list was windowed.
 */
export function planRows(input: PlanInput): RowPlanEntry[] {
  const { count, rowHeight, scrollTop, viewportHeight, overscan, pinned } = input;
  if (count === 0) return [];
  const first = Math.min(Math.max(0, Math.floor(scrollTop / rowHeight)), count - 1);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);

  const indices = new Set<number>();
  for (let i = start; i < end; i++) indices.add(i);
  for (const index of pinned) if (index >= 0 && index < count) indices.add(index);
  const sorted = [...indices].sort((a, b) => a - b);

  const plan: RowPlanEntry[] = [];
  let next = 0;
  for (const index of sorted) {
    if (index > next) plan.push({ kind: 'gap', start: next, height: (index - next) * rowHeight });
    plan.push({ kind: 'row', index });
    next = index + 1;
  }
  if (next < count) plan.push({ kind: 'gap', start: next, height: (count - next) * rowHeight });
  return plan;
}
