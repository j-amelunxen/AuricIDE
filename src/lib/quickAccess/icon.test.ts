import { describe, expect, it } from 'vitest';
import { firstGrapheme, projectIconFor, resolveTileIcon } from './icon';
import { generateProjectIcon } from '@/lib/projectIcon';
import { QUICK_ACCESS_GLYPHS } from './glyphs';
import { getGlyph } from '@/lib/icons/registry';

describe('firstGrapheme', () => {
  it('keeps a ZWJ sequence together instead of splitting the emoji', () => {
    expect(firstGrapheme('👩‍💻')).toBe('👩‍💻');
  });

  it('keeps a skin-tone modifier attached', () => {
    expect(firstGrapheme('👍🏽')).toBe('👍🏽');
  });

  it('takes only the first character when several are pasted', () => {
    expect(firstGrapheme('🚀🔥')).toBe('🚀');
  });

  it('ignores surrounding whitespace', () => {
    expect(firstGrapheme('  🚀  ')).toBe('🚀');
  });

  it('returns nothing for an empty input', () => {
    expect(firstGrapheme('   ')).toBe('');
  });
});

describe('resolveTileIcon', () => {
  const initials = generateProjectIcon('/a/website').initials;

  it('generates initials when nothing is stored', () => {
    expect(resolveTileIcon('/a/website')).toEqual({ kind: 'initials', initials });
  });

  it('draws a stored glyph', () => {
    expect(resolveTileIcon('/a/website', { kind: 'glyph', value: 'rocket_launch' })).toEqual({
      kind: 'glyph',
      name: 'rocket_launch',
    });
  });

  it('draws a stored emoji', () => {
    expect(resolveTileIcon('/a/website', { kind: 'emoji', value: '🚀' })).toEqual({
      kind: 'emoji',
      char: '🚀',
    });
  });

  // The stored name is user data, so the registry is the only thing standing
  // between a renamed glyph and an empty box on the tile.
  it('falls back to initials when the stored glyph left the registry', () => {
    expect(resolveTileIcon('/a/website', { kind: 'glyph', value: 'no_such_glyph' })).toEqual({
      kind: 'initials',
      initials,
    });
  });

  it('falls back to initials for an icon kind it does not recognise', () => {
    const stored = { kind: 'sticker', value: 'x' } as unknown as Parameters<
      typeof resolveTileIcon
    >[1];
    expect(resolveTileIcon('/a/website', stored)).toEqual({ kind: 'initials', initials });
  });

  it('falls back to initials for a blank emoji', () => {
    expect(resolveTileIcon('/a/website', { kind: 'emoji', value: '  ' })).toEqual({
      kind: 'initials',
      initials,
    });
  });
});

describe('QUICK_ACCESS_GLYPHS', () => {
  // The coverage test only scans source literals, so a name reaching AuricIcon
  // from stored data is unguarded. This is that guard.
  it('offers only names the icon registry can actually draw', () => {
    const missing = QUICK_ACCESS_GLYPHS.filter((name) => !getGlyph(name));
    expect(missing).toEqual([]);
  });

  it('offers each glyph once', () => {
    expect(new Set(QUICK_ACCESS_GLYPHS).size).toBe(QUICK_ACCESS_GLYPHS.length);
  });
});

describe('projectIconFor', () => {
  const pinned = [
    { path: '/repo/alpha', icon: { kind: 'emoji', value: '🚀' } as const },
    { path: '/repo/beta' },
  ];

  it('finds the mark a project was pinned with', () => {
    expect(projectIconFor(pinned, '/repo/alpha')).toEqual({ kind: 'emoji', value: '🚀' });
  });

  it('has nothing for a pinned project that never got a mark', () => {
    expect(projectIconFor(pinned, '/repo/beta')).toBeUndefined();
  });

  it('has nothing for a project that was never pinned', () => {
    expect(projectIconFor(pinned, '/repo/unknown')).toBeUndefined();
  });

  // An app-wide row has no project to draw.
  it('has nothing for no project at all', () => {
    expect(projectIconFor(pinned, null)).toBeUndefined();
  });
});
