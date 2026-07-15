import { describe, expect, it } from 'vitest';
import { generateProjectIcon, PALETTE_HUES } from './projectIcon';

describe('generateProjectIcon', () => {
  it('is deterministic — same identity always yields the same icon', () => {
    const a = generateProjectIcon('/Users/jen/projects/apps');
    const b = generateProjectIcon('/Users/jen/projects/apps');
    expect(a).toEqual(b);
  });

  it('assigns hues only from the curated palette', () => {
    for (const p of ['/a/apps', '/b/website', '/c/deep/thing', '/x/my-cool-app', '']) {
      expect(PALETTE_HUES).toContain(generateProjectIcon(p).hue);
    }
  });

  it('spreads a realistic project set across several palette slots', () => {
    const paths = [
      '/w/alpha-pipeline',
      '/w/bravoFlow',
      '/w/charlie-full',
      '/w/deltas',
      '/w/echoAgent',
    ];
    const hues = new Set(paths.map((p) => generateProjectIcon(p).hue));
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });

  it('uses uniform saturation and lightness so tiles read as one family', () => {
    const one = generateProjectIcon('/a/apps');
    const two = generateProjectIcon('/b/website');
    const strip = (s: string) => s.replace(/hsl\(\d+,/, 'hsl(H,');
    expect(strip(one.gradientFrom)).toBe(strip(two.gradientFrom));
    expect(strip(one.gradientTo)).toBe(strip(two.gradientTo));
  });

  it('derives up to two initials from the last path segment', () => {
    expect(generateProjectIcon('/Users/jen/projects/apps').initials).toBe('AP');
  });

  it('uses word boundaries for initials on hyphenated names', () => {
    expect(generateProjectIcon('/x/my-cool-app').initials).toBe('MC');
  });

  it('uppercases single-word initials to two letters', () => {
    expect(generateProjectIcon('/x/website').initials).toBe('WE');
  });

  it('tolerates a trailing slash on the path', () => {
    const trailing = generateProjectIcon('/x/apps/');
    const plain = generateProjectIcon('/x/apps');
    expect(trailing).toEqual(plain);
  });

  it('produces a hue within [0, 360)', () => {
    for (const p of ['/a', '/b/c', '/some/deep/nested/thing', '/apps']) {
      const icon = generateProjectIcon(p);
      expect(icon.hue).toBeGreaterThanOrEqual(0);
      expect(icon.hue).toBeLessThan(360);
    }
  });

  it('keeps the gradient inside the tile hue family', () => {
    const icon = generateProjectIcon('/x/apps');
    const from = Number(/hsl\((\d+)/.exec(icon.gradientFrom)?.[1]);
    const to = Number(/hsl\((\d+)/.exec(icon.gradientTo)?.[1]);
    expect(from).toBe(icon.hue);
    expect((to - from + 360) % 360).toBeLessThanOrEqual(20);
  });

  it('emits gradient stops as hsl() strings', () => {
    const icon = generateProjectIcon('/x/apps');
    expect(icon.gradientFrom).toMatch(/^hsl\(/);
    expect(icon.gradientTo).toMatch(/^hsl\(/);
  });

  it('falls back to a placeholder for an empty identity', () => {
    const icon = generateProjectIcon('');
    expect(icon.initials).toBe('?');
    expect(icon.hue).toBeGreaterThanOrEqual(0);
    expect(icon.hue).toBeLessThan(360);
  });
});
