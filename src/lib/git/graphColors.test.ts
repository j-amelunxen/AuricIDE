import { describe, expect, it } from 'vitest';
import { GRAPH_COLORS, GRAPH_COLOR_COUNT, graphColorHex } from './graphColors';

describe('graphColors', () => {
  it('offers distinct hex colours', () => {
    expect(GRAPH_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(GRAPH_COLORS).size).toBe(GRAPH_COLORS.length);
    for (const hex of GRAPH_COLORS) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('wraps indexes past the end and below zero', () => {
    expect(graphColorHex(0)).toBe(GRAPH_COLORS[0]);
    expect(graphColorHex(GRAPH_COLOR_COUNT)).toBe(GRAPH_COLORS[0]);
    expect(graphColorHex(GRAPH_COLOR_COUNT + 2)).toBe(GRAPH_COLORS[2]);
    expect(graphColorHex(-1)).toBe(GRAPH_COLORS[GRAPH_COLOR_COUNT - 1]);
  });
});
