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

  it('glyph names are snake_case identifiers', () => {
    for (const name of Object.keys(ICON_GLYPHS)) {
      expect(name).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });
});
