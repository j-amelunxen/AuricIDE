import { getGlyph } from '@/lib/icons/registry';
import { generateProjectIcon } from '@/lib/projectIcon';
import { isRenderableIcon, type ProjectIconOverride } from '@/lib/store/starredProjectsSlice';

/** What a tile actually draws, once the stored preference has been checked. */
export type ResolvedTileIcon =
  | { kind: 'glyph'; name: string }
  | { kind: 'emoji'; char: string }
  | { kind: 'image'; path: string }
  | { kind: 'initials'; initials: string };

/**
 * The first user-visible character, keeping ZWJ sequences (👩‍💻) and skin-tone
 * modifiers intact — splitting those by code point produces a different emoji.
 */
export function firstGrapheme(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(trimmed)][0]?.segment ?? '';
  }
  // Surrogate-pair safe, but blind to ZWJ joins. Only reached on engines
  // without Segmenter.
  return [...trimmed][0] ?? '';
}

/**
 * The mark a project was pinned with, for the places that draw a project tile
 * without holding the pinned record itself — schedule rows, inbox rows.
 *
 * An unpinned project simply has none, and `resolveTileIcon` turns that into
 * the generated initials, which is the same tile it had before anyone picked
 * an icon.
 */
export function projectIconFor(
  pinned: { path: string; icon?: ProjectIconOverride }[],
  path: string | null
): ProjectIconOverride | undefined {
  if (path === null || path === '') return undefined;
  return pinned.find((project) => project.path === path)?.icon;
}

/**
 * Decides what a Quick Access tile draws.
 *
 * The glyph name comes from stored user data, so it is NOT covered by the
 * icon coverage test, which only scans source literals. A name that has since
 * left the registry has to degrade to the generated initials — otherwise
 * AuricIcon renders an empty 24×24 box and the tile reads as broken.
 */
export function resolveTileIcon(
  path: string,
  custom?: ProjectIconOverride | null
): ResolvedTileIcon {
  if (isRenderableIcon(custom)) {
    if (custom.kind === 'glyph' && getGlyph(custom.value)) {
      return { kind: 'glyph', name: custom.value };
    }
    if (custom.kind === 'emoji') {
      const char = firstGrapheme(custom.value);
      if (char) return { kind: 'emoji', char };
    }
    // Whether the file still exists is not knowable here — the tile resolves
    // that when it loads the bytes, and falls back to initials if it cannot.
    if (custom.kind === 'image') {
      return { kind: 'image', path: custom.value };
    }
  }
  return { kind: 'initials', initials: generateProjectIcon(path).initials };
}
