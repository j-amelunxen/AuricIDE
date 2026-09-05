/**
 * How much room the Agent Console gives its two stacked regions — the project
 * grid and the activity feed below it — and how much of that the reader gets
 * to decide.
 *
 * The feed used to be a fixed 168px strip. That is enough to see that
 * something is happening and not enough to read it, which is the wrong trade
 * whenever the feed is the thing being watched. So the divider between the two
 * became a real one: draggable, keyboard-operable, remembered.
 *
 * The arithmetic lives here rather than in the component because both ends of
 * it are load-bearing. A feed pulled past the bottom of the window would take
 * the grid with it, and a stored height from a larger monitor would do the
 * same on the next launch — so every path into a height goes through
 * `clampFeedHeight`, including the one that reads it back off disk.
 */

import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';

/** Roughly four rows plus the feed's own header: still a feed, not a sliver. */
export const CONSOLE_FEED_MIN_HEIGHT = 96;

/**
 * What Home returns to. The strip started at 168px, enough to see that
 * something is happening; since the feed became lanes with a rail and a
 * composer, that left two rows of conversation, so the default grew.
 */
export const CONSOLE_FEED_DEFAULT_HEIGHT = 280;

/** The share of the window the feed may take. The rest stays the fleet's. */
export const CONSOLE_FEED_MAX_FRACTION = 0.7;

/** One arrow-key press, in pixels. */
export const CONSOLE_FEED_KEY_STEP = 24;

/**
 * The tallest the feed may be drawn in a window this high.
 *
 * An unmeasured window (`0`) is unbounded rather than tiny: it means "no
 * layout has happened yet", and treating that as a measurement would collapse
 * the feed to its floor on the first frame and leave it there.
 */
export function maxFeedHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(CONSOLE_FEED_MIN_HEIGHT, Math.round(viewportHeight * CONSOLE_FEED_MAX_FRACTION));
}

/** The one door every height passes through: drag, key press and stored value. */
export function clampFeedHeight(height: number, viewportHeight: number): number {
  const wanted = Number.isFinite(height) ? height : CONSOLE_FEED_DEFAULT_HEIGHT;
  return Math.round(
    Math.min(maxFeedHeight(viewportHeight), Math.max(CONSOLE_FEED_MIN_HEIGHT, wanted))
  );
}

/**
 * The height a key press asks for, or `null` for a key the handle does not
 * own — so an unclaimed keystroke still reaches whatever else wants it.
 *
 * Up grows the feed because the handle *is* its top edge: the key moves the
 * divider, exactly as the pointer does.
 */
export function feedHeightForKey(
  key: string,
  current: number,
  viewportHeight: number
): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampFeedHeight(current + CONSOLE_FEED_KEY_STEP, viewportHeight);
    case 'ArrowDown':
      return clampFeedHeight(current - CONSOLE_FEED_KEY_STEP, viewportHeight);
    case 'Home':
      return clampFeedHeight(CONSOLE_FEED_DEFAULT_HEIGHT, viewportHeight);
    case 'End':
      return maxFeedHeight(viewportHeight) === Number.POSITIVE_INFINITY
        ? null
        : maxFeedHeight(viewportHeight);
    default:
      return null;
  }
}

/**
 * The remembered height, floored but not capped: the window this is read in
 * may be a different one from the window it was written in, and the mount that
 * reads it is what knows how tall that window now is.
 */
export function readFeedHeight(): number {
  const raw = readAppPref(APP_CONFIG_KEYS.agentConsoleFeedHeight);
  if (raw === null || raw.trim() === '') return CONSOLE_FEED_DEFAULT_HEIGHT;
  const value = Number(raw);
  if (!Number.isFinite(value)) return CONSOLE_FEED_DEFAULT_HEIGHT;
  return Math.round(Math.max(CONSOLE_FEED_MIN_HEIGHT, value));
}

export function writeFeedHeight(height: number): void {
  writeAppPref(APP_CONFIG_KEYS.agentConsoleFeedHeight, String(Math.round(height)));
}

/** Whether the list of projects with nothing running is folded away. */
export function readProjectsCollapsed(): boolean {
  return readAppPref(APP_CONFIG_KEYS.agentConsoleProjectsCollapsed) === 'true';
}

export function writeProjectsCollapsed(collapsed: boolean): void {
  writeAppPref(APP_CONFIG_KEYS.agentConsoleProjectsCollapsed, String(collapsed));
}
