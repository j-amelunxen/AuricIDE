import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphRow } from '@/lib/git/graphLayout';
import {
  LANE_WIDTH,
  LANE_PAD,
  MAX_VISIBLE_LANES,
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  edgePath,
  laneColumnWidth,
  laneX,
  scrollTopToCentre,
  scrollTopToShow,
  visibleRange,
} from './graphGeometry';

const edge = (fromLane: number, toLane: number, part: GraphEdge['part']): GraphEdge => ({
  fromLane,
  toLane,
  color: 0,
  part,
});

const row = (width: number): GraphRow => ({
  oid: 'x',
  lane: 0,
  color: 0,
  edges: [],
  isMerge: false,
  width,
});

describe('laneX', () => {
  it('centres lane n on a fixed pitch', () => {
    expect(laneX(0)).toBe(LANE_PAD);
    expect(laneX(3)).toBe(LANE_PAD + 3 * LANE_WIDTH);
  });
});

describe('edgePath', () => {
  const half = ROW_HEIGHT / 2;

  it('draws a straight segment for the top half of a lane', () => {
    expect(edgePath(edge(1, 1, 'top'))).toBe(`M ${laneX(1)} 0 L ${laneX(1)} ${half}`);
  });

  it('draws a straight segment for the bottom half of a lane', () => {
    expect(edgePath(edge(0, 0, 'bottom'))).toBe(
      `M ${laneX(0)} ${half} L ${laneX(0)} ${ROW_HEIGHT}`
    );
  });

  it('bends a merge-in from the top edge to the dot lane', () => {
    const d = edgePath(edge(2, 0, 'top'));
    expect(d.startsWith(`M ${laneX(2)} 0 C`)).toBe(true);
    expect(d.endsWith(`${laneX(0)} ${half}`)).toBe(true);
  });

  it('bends a fork from the dot lane to the bottom edge', () => {
    const d = edgePath(edge(0, 2, 'bottom'));
    expect(d.startsWith(`M ${laneX(0)} ${half} C`)).toBe(true);
    expect(d.endsWith(`${laneX(2)} ${ROW_HEIGHT}`)).toBe(true);
  });
});

describe('laneColumnWidth', () => {
  it('fits the widest row', () => {
    expect(laneColumnWidth([row(1), row(4), row(2)])).toBe(LANE_PAD * 2 + 3 * LANE_WIDTH);
  });

  it('keeps one lane of room for an empty graph', () => {
    expect(laneColumnWidth([])).toBe(LANE_PAD * 2);
  });

  it('stops growing at the lane cap so one wide burst cannot squeeze the summary', () => {
    expect(laneColumnWidth([row(MAX_VISIBLE_LANES + 20)])).toBe(
      LANE_PAD * 2 + (MAX_VISIBLE_LANES - 1) * LANE_WIDTH
    );
  });
});

describe('visibleRange', () => {
  it('renders the viewport plus overscan on both sides', () => {
    const range = visibleRange(ROW_HEIGHT * 100, ROW_HEIGHT * 20, 1000);
    expect(range).toEqual({ start: 100 - OVERSCAN_ROWS, end: 120 + OVERSCAN_ROWS });
  });

  it('clamps at the top and the bottom of the list', () => {
    expect(visibleRange(0, ROW_HEIGHT * 5, 1000).start).toBe(0);
    expect(visibleRange(ROW_HEIGHT * 995, ROW_HEIGHT * 20, 1000).end).toBe(1000);
  });

  it('renders nothing for an empty list', () => {
    expect(visibleRange(0, 500, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('scrollTopToShow', () => {
  const viewport = ROW_HEIGHT * 10;
  it('leaves the scroll alone when the row is already visible', () => {
    expect(scrollTopToShow(12, ROW_HEIGHT * 10, viewport)).toBe(ROW_HEIGHT * 10);
  });
  it('scrolls up just enough to show a row above the viewport', () => {
    expect(scrollTopToShow(3, ROW_HEIGHT * 10, viewport)).toBe(ROW_HEIGHT * 3);
  });
  it('scrolls down just enough to show a row below the viewport', () => {
    expect(scrollTopToShow(25, 0, viewport)).toBe(ROW_HEIGHT * 26 - viewport);
  });
});

describe('scrollTopToCentre', () => {
  it('centres the row, but never scrolls above the top', () => {
    expect(scrollTopToCentre(100, ROW_HEIGHT * 10)).toBe(
      ROW_HEIGHT * 100 - ROW_HEIGHT * 5 + ROW_HEIGHT / 2
    );
    expect(scrollTopToCentre(1, ROW_HEIGHT * 10)).toBe(0);
  });
});
