import { actionsGlyphs } from './glyphs/actions';
import { coreGlyphs } from './glyphs/core';
import { filesGlyphs } from './glyphs/files';
import { futureGlyphs } from './glyphs/future';
import { navigationGlyphs } from './glyphs/navigation';
import { objectsGlyphs } from './glyphs/objects';
import { statusGlyphs } from './glyphs/status';
import type { IconGlyph } from './types';

/**
 * The Auric Line icon registry. Names intentionally keep the Material
 * Symbols ligature vocabulary the codebase already speaks — the swap to the
 * in-house set changes the renderer, not every call site's vocabulary.
 */
export const ICON_GLYPHS: Record<string, IconGlyph> = {
  ...coreGlyphs,
  ...filesGlyphs,
  ...futureGlyphs,
  ...navigationGlyphs,
  ...actionsGlyphs,
  ...objectsGlyphs,
  ...statusGlyphs,
};

/** Names that render an existing glyph rather than getting their own. */
export const ICON_ALIASES: Record<string, string> = {
  dashboard: 'space_dashboard',
  robot_2: 'smart_toy',
  keyboard_arrow_down: 'expand_more',
  replay: 'refresh',
  restart_alt: 'refresh',
  horizontal_rule: 'remove',
  auto_stories: 'menu_book',
  source: 'folder',
  insert_drive_file: 'draft',
  verified: 'check_circle',
};

export function getGlyph(name: string): IconGlyph | null {
  const resolved = ICON_GLYPHS[name] ?? ICON_GLYPHS[ICON_ALIASES[name] ?? ''];
  return resolved ?? null;
}
