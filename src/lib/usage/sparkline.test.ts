import { describe, expect, it } from 'vitest';

import { changeAgainst, sparklinePath, sparklineArea } from './sparkline';

describe('sparklinePath', () => {
  it('spreads the points across the full width', () => {
    const path = sparklinePath([0, 1, 0], { width: 100, height: 10, max: 1 });
    expect(path).toMatch(/^M0,/);
    expect(path).toContain('L100,');
  });

  it('puts the maximum at the top and zero on the baseline', () => {
    // y grows downward in SVG, so the peak is the smallest y.
    const path = sparklinePath([0, 1], { width: 10, height: 20, max: 1 });
    const ys = [...path.matchAll(/[ML]\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBe(20);
    expect(ys[1]).toBe(0);
  });

  it('scales against the given maximum, not its own', () => {
    // The whole point of small multiples: every row shares one scale, so a
    // quiet row must render quiet rather than being stretched to full height.
    const quiet = sparklinePath([0, 1], { width: 10, height: 20, max: 100 });
    const ys = [...quiet.matchAll(/[ML]\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(ys[1]).toBeGreaterThan(19);
  });

  it('draws a flat baseline when every value is zero', () => {
    const path = sparklinePath([0, 0, 0], { width: 10, height: 20, max: 0 });
    const ys = [...path.matchAll(/[ML]\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(new Set(ys)).toEqual(new Set([20]));
  });

  it('has nothing to draw for an empty series', () => {
    expect(sparklinePath([], { width: 10, height: 20, max: 1 })).toBe('');
  });

  it('still draws a single point as a line', () => {
    // A one-bucket window is degenerate but must not render as an invisible
    // zero-length path.
    const path = sparklinePath([5], { width: 10, height: 20, max: 10 });
    expect(path).toContain('M0,');
    expect(path).toContain('L10,');
  });
});

describe('sparklineArea', () => {
  it('closes the path down to the baseline', () => {
    const area = sparklineArea([1, 1], { width: 10, height: 20, max: 1 });
    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain('L10,20');
    expect(area).toContain('L0,20');
  });

  it('has nothing to fill for an empty series', () => {
    expect(sparklineArea([], { width: 10, height: 20, max: 1 })).toBe('');
  });
});

describe('changeAgainst', () => {
  it('reports the relative change', () => {
    expect(changeAgainst(120, 100)).toEqual({ ratio: 0.2, direction: 'up' });
    expect(changeAgainst(80, 100)).toEqual({ ratio: -0.2, direction: 'down' });
  });

  it('calls a change under one percent flat', () => {
    // Noise dressed up as a trend is worse than no arrow at all.
    expect(changeAgainst(100.5, 100)?.direction).toBe('flat');
    expect(changeAgainst(99.5, 100)?.direction).toBe('flat');
  });

  it('declines to compare against a period with no spend', () => {
    // Any increase over zero is an infinite one; an arrow saying "+∞%" is a
    // division artefact, not a finding.
    expect(changeAgainst(50, 0)).toBeNull();
  });

  it('declines to compare when there is no earlier period at all', () => {
    expect(changeAgainst(50, null)).toBeNull();
  });

  it('reports a drop to zero as a full decrease', () => {
    expect(changeAgainst(0, 100)).toEqual({ ratio: -1, direction: 'down' });
  });
});
