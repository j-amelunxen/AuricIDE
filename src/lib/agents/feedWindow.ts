import { feedRowKey } from './events/feed';
import type { FeedGroup } from './lanes';

/** Only the newest this many shown rows are in the DOM — see rule 6. */
export const FEED_RENDER_LIMIT = 300;
/** How many more "Show earlier" reveals at a time. */
export const FEED_REVEAL_STEP = 300;

/**
 * The newest `revealedCount` rows of `groups`, trimmed at the group level
 * rather than by re-slicing rows before grouping.
 *
 * That distinction is the whole point: the caller memoizes `groups` on the
 * full row list, so an unaffected group is the *same object* across renders.
 * Slicing rows first and grouping the slice (the old approach) rebuilt every
 * group from scratch on every arrival, and the boundary group's key — its
 * own first row — changed on every tick as the slice edge marched through
 * it, remounting a DOM block that never actually left the screen. Keying by
 * the *original* group's first row here means that block keeps its identity
 * for as long as any part of it is still visible, and only remounts once it
 * has genuinely scrolled out of the window.
 */
export function trimGroupsToWindow(
  groups: FeedGroup[],
  revealedCount: number
): { key: string; group: FeedGroup }[] {
  const result: { key: string; group: FeedGroup }[] = [];
  let remaining = revealedCount;
  for (let i = groups.length - 1; i >= 0 && remaining > 0; i--) {
    const original = groups[i];
    const key = feedRowKey(original.rows[0]);
    if (original.rows.length <= remaining) {
      result.unshift({ key, group: original });
      remaining -= original.rows.length;
    } else {
      const rows = original.rows.slice(original.rows.length - remaining);
      result.unshift({ key, group: { ...original, rows } });
      remaining = 0;
    }
  }
  return result;
}
