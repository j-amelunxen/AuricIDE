import { AGENT_COLORS, agentColorHex, type AgentColor } from '@/lib/agents/colors';
import type { ProjectBadge, StarredProject } from '@/lib/tauri/starredProjects';

/**
 * One lane mark on a Quick Access tile. Six characters is enough for "fe" or
 * "lane2" and still fits under a 40px tile. The twin limit lives in Rust as
 * `BADGE_MAX_CHARS` (`recent_projects/types.rs`); both sides collapse
 * whitespace the same way, then cut, then trim the cut.
 */
export const BADGE_MAX_CHARS = 6;

export const QUICK_ACCESS_SORTS = ['name', 'badge'] as const;
export type QuickAccessSort = (typeof QUICK_ACCESS_SORTS)[number];

/** Blue first: red reads as an alarm next to the dirty dot and the remove ×. */
const SUGGESTED_COLORS: readonly AgentColor[] = [
  'blue',
  'green',
  'purple',
  'orange',
  'yellow',
  'red',
];

function collapseWhitespace(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Empty text clears the badge. A blank colour becomes blue; any other colour
 * key is kept, even one this build does not paint — Rust does the same.
 */
export function normalizeProjectBadge(
  badge: { text: string; color: string } | null | undefined
): ProjectBadge | null {
  if (!badge) return null;
  const text = Array.from(collapseWhitespace(badge.text)).slice(0, BADGE_MAX_CHARS).join('').trim();
  if (!text) return null;
  const color = badge.color.trim();
  return { text, color: color.length > 0 ? color : 'blue' };
}

export function isAgentColor(color: string | undefined): color is AgentColor {
  return AGENT_COLORS.some((option) => option.key === color);
}

/** First colour none of the other tiles already wears. */
export function suggestedBadgeColor(usedByOthers: readonly string[]): AgentColor {
  const taken = new Set(usedByOthers);
  return SUGGESTED_COLORS.find((key) => !taken.has(key)) ?? 'blue';
}

/** Keep a colour this tile already has. An unknown one falls through to a free suggestion. */
export function initialBadgeColor(
  current: string | undefined,
  usedByOthers: readonly string[]
): AgentColor {
  if (isAgentColor(current)) return current;
  return suggestedBadgeColor(usedByOthers);
}

/** Hex for a stored colour. An unknown key paints as blue rather than disappearing. */
export function badgeColorHex(color: string): string {
  return (isAgentColor(color) ? agentColorHex(color) : null) ?? '#4aa8ff';
}

/**
 * The chip's ink, wash and hairline. The colour stays on the chip: the tile's
 * ring is "this project is open" and the amber dot is "uncommitted", and a
 * badge must not repaint either of those.
 */
export function badgeChipStyle(color: string): {
  color: string;
  backgroundColor: string;
  boxShadow: string;
} {
  const hex = badgeColorHex(color);
  return {
    color: hex,
    backgroundColor: `${hex}24`,
    boxShadow: `inset 0 0 0 1px ${hex}66`,
  };
}

/**
 * Badges already stuck on a tile, one per text. The menu offers them as
 * one-click flags: a temporary mark gets reused, not retyped.
 */
export function usedBadges(
  projects: readonly { badge?: { text: string; color: string } | null }[]
): ProjectBadge[] {
  const seen = new Set<string>();
  const badges: ProjectBadge[] = [];
  for (const project of projects) {
    const badge = normalizeProjectBadge(project.badge);
    if (!badge) continue;
    const key = badge.text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    badges.push(badge);
  }
  badges.sort((a, b) =>
    a.text.localeCompare(b.text, undefined, { sensitivity: 'base', numeric: true })
  );
  return badges;
}

export function parseQuickAccessSort(raw: string | null): QuickAccessSort {
  return raw === 'badge' ? 'badge' : 'name';
}

function byNameThenPath(
  a: Pick<StarredProject, 'name' | 'path'>,
  b: Pick<StarredProject, 'name' | 'path'>
): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  if (byName !== 0) return byName;
  return a.path.localeCompare(b.path);
}

/**
 * `name` is the default and ignores badges, so pinning a mark does not slide
 * the tile out from under a remembered position. `badge` groups marked tiles
 * by the text (case-insensitive) and leaves unmarked ones after them, still
 * by name. Equal names break on the path, so three checkouts of one repo
 * stay in a stable order.
 */
export function sortQuickAccessProjects<T extends Pick<StarredProject, 'name' | 'path' | 'badge'>>(
  projects: readonly T[],
  mode: QuickAccessSort
): T[] {
  const copy = [...projects];
  copy.sort((a, b) => {
    if (mode === 'badge') {
      const aText = normalizeProjectBadge(a.badge)?.text ?? null;
      const bText = normalizeProjectBadge(b.badge)?.text ?? null;
      if (aText && !bText) return -1;
      if (!aText && bText) return 1;
      if (aText && bText) {
        const byBadge = aText.localeCompare(bText, undefined, {
          sensitivity: 'base',
          numeric: true,
        });
        if (byBadge !== 0) return byBadge;
      }
    }
    return byNameThenPath(a, b);
  });
  return copy;
}
