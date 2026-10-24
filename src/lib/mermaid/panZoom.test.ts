import { describe, expect, it } from 'vitest';
import { IDENTITY_VIEW, MAX_SCALE, MIN_SCALE, panBy, zoomAt } from './panZoom';

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const next = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(next.scale).toBe(2);
    // the diagram point under the cursor is (100,50) before and after
    expect(100 * next.scale + next.x).toBeCloseTo(100);
    expect(50 * next.scale + next.y).toBeCloseTo(50);
  });

  it('clamps to the scale limits', () => {
    expect(zoomAt(IDENTITY_VIEW, 1000, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt(IDENTITY_VIEW, 0.0001, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });

  it('does not move the view when already at the limit', () => {
    const atMax = { scale: MAX_SCALE, x: 5, y: 7 };
    expect(zoomAt(atMax, 2, { x: 30, y: 30 })).toEqual(atMax);
  });
});

describe('panBy', () => {
  it('moves the view by the drag delta and keeps the scale', () => {
    expect(panBy({ scale: 2, x: 10, y: 10 }, 5, -3)).toEqual({ scale: 2, x: 15, y: 7 });
  });
});
