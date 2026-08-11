import { describe, expect, it } from 'vitest';
import { LINE_HUES, lineHue } from './lineColors';

describe('lineColors', () => {
  it('exposes a palette of explicit hex values', () => {
    expect(LINE_HUES.length).toBeGreaterThanOrEqual(8);
    for (const hue of LINE_HUES) {
      expect(hue).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('always returns a palette member', () => {
    for (const id of ['a', 'b', 'goal-1', crypto.randomUUID()]) {
      expect(LINE_HUES).toContain(lineHue(id));
    }
  });

  it('is deterministic for the same goal id', () => {
    const id = 'f2b9c1d0-0000-4000-8000-000000000001';
    expect(lineHue(id)).toBe(lineHue(id));
  });

  it('spreads different ids across the palette', () => {
    const hues = new Set(Array.from({ length: 40 }, (_, i) => lineHue(`goal-${i}-${i * 31}`)));
    // Not a strict uniformity claim — just that the hash is not collapsing
    // everything onto one or two hues.
    expect(hues.size).toBeGreaterThanOrEqual(Math.min(5, LINE_HUES.length));
  });
});
