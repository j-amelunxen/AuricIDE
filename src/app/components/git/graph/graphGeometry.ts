import type { GraphEdge, GraphRow } from '@/lib/git/graphLayout';

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 14;
/** Distance from the column's left edge to the centre of lane 0: the dot's left edge sits on the toolbar's 12px inset. */
export const LANE_PAD = 16;
export const DOT_RADIUS = 4;
export const LINE_WIDTH = 2;
/** Beyond this the lane column stops growing; wider bursts are clipped, not squeezed in. */
export const MAX_VISIBLE_LANES = 12;
export const OVERSCAN_ROWS = 10;
/** The next page is requested when the viewport is this close to the end. */
export const LOAD_MORE_MARGIN_ROWS = 40;

export const laneX = (lane: number): number => LANE_PAD + lane * LANE_WIDTH;

/** SVG path of one segment; a segment between two lanes is an S-curve over its half row. */
export function edgePath({ fromLane, toLane, part }: GraphEdge): string {
  const half = ROW_HEIGHT / 2;
  const y0 = part === 'top' ? 0 : half;
  const y1 = y0 + half;
  const x0 = laneX(fromLane);
  const x1 = laneX(toLane);
  if (x0 === x1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const mid = (y0 + y1) / 2;
  return `M ${x0} ${y0} C ${x0} ${mid} ${x1} ${mid} ${x1} ${y1}`;
}

/** One width for every row, so the summary column never shifts as lanes come and go. */
export function laneColumnWidth(rows: GraphRow[]): number {
  const widest = rows.reduce((max, r) => Math.max(max, r.width), 1);
  return LANE_PAD * 2 + (Math.min(widest, MAX_VISIBLE_LANES) - 1) * LANE_WIDTH;
}

export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const last = Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT);
  return {
    start: Math.max(0, first - OVERSCAN_ROWS),
    end: Math.min(count, last + OVERSCAN_ROWS),
  };
}

/** The smallest scroll that brings row `index` fully into view; unchanged when it already is. */
export function scrollTopToShow(index: number, scrollTop: number, viewportHeight: number): number {
  const top = index * ROW_HEIGHT;
  if (top < scrollTop) return top;
  const bottom = top + ROW_HEIGHT;
  return bottom > scrollTop + viewportHeight ? bottom - viewportHeight : scrollTop;
}

/** The scroll that puts row `index` in the middle of the viewport (never above the top). */
export function scrollTopToCentre(index: number, viewportHeight: number): number {
  return Math.max(0, index * ROW_HEIGHT - viewportHeight / 2 + ROW_HEIGHT / 2);
}
