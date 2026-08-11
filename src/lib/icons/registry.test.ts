import { describe, expect, it } from 'vitest';
import { getGlyph, ICON_GLYPHS } from './registry';

describe('icon registry', () => {
  it('resolves a known glyph', () => {
    expect(getGlyph('folder')).toBeTruthy();
  });

  it('returns null for unknown names', () => {
    expect(getGlyph('definitely_not_an_icon')).toBeNull();
  });

  it('every glyph has at least one primitive', () => {
    for (const [name, glyph] of Object.entries(ICON_GLYPHS)) {
      expect(glyph.length, `glyph "${name}" is empty`).toBeGreaterThan(0);
    }
  });

  it('every glyph keeps the accent restrained: at most one accent primitive', () => {
    for (const [name, glyph] of Object.entries(ICON_GLYPHS)) {
      const accents = glyph.filter((p) => 'accent' in p && p.accent).length;
      expect(accents, `glyph "${name}" has ${accents} accent primitives`).toBeLessThanOrEqual(1);
    }
  });

  it('non-path primitives stay inside the 24px grid', () => {
    for (const [name, glyph] of Object.entries(ICON_GLYPHS)) {
      for (const prim of glyph) {
        const coords: number[] = [];
        if (prim.kind === 'circle') {
          coords.push(prim.cx - prim.r, prim.cx + prim.r, prim.cy - prim.r, prim.cy + prim.r);
        } else if (prim.kind === 'rect') {
          coords.push(prim.x, prim.x + prim.w, prim.y, prim.y + prim.h);
        } else if (prim.kind === 'line') {
          coords.push(prim.x1, prim.x2, prim.y1, prim.y2);
        }
        for (const v of coords) {
          expect(v, `glyph "${name}" leaves the grid (${v})`).toBeGreaterThanOrEqual(0);
          expect(v, `glyph "${name}" leaves the grid (${v})`).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it('glyph names are snake_case identifiers', () => {
    for (const name of Object.keys(ICON_GLYPHS)) {
      expect(name).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });
});
