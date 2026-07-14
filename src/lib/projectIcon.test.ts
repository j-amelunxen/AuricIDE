import { describe, expect, it } from 'vitest';
import { generateProjectIcon } from './projectIcon';

describe('generateProjectIcon', () => {
  it('is deterministic — same identity always yields the same icon', () => {
    const a = generateProjectIcon('/Users/jen/projects/apps');
    const b = generateProjectIcon('/Users/jen/projects/apps');
    expect(a).toEqual(b);
  });

  it('gives different projects different hues', () => {
    const apps = generateProjectIcon('/Users/jen/projects/apps');
    const web = generateProjectIcon('/Users/jen/projects/website');
    expect(apps.hue).not.toBe(web.hue);
  });

  it('distinguishes same name under different paths', () => {
    const one = generateProjectIcon('/a/apps');
    const two = generateProjectIcon('/b/apps');
    expect(one.hue).not.toBe(two.hue);
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
