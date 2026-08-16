/**
 * Where the hover card that shows a tab's original prompt is drawn.
 *
 * The tab strip scrolls sideways, so the card cannot live inside it — it is
 * drawn in viewport coordinates and measured off the tab. That hands us the
 * two ways it could leave the screen: the rightmost tab of a wide fleet would
 * push it past the right edge, and a strip low on the screen would leave no
 * room underneath.
 */

/** How long the pointer has to rest on a tab before the prompt appears. */
export const TAB_PREVIEW_DELAY_MS = 500;

/**
 * How long the card survives the pointer leaving the tab. It only has to
 * cover the gap between tab and card, so the user can reach in to scroll a
 * long prompt or select it.
 */
export const TAB_PREVIEW_GRACE_MS = 140;

/** Wide enough for a prompt to read as prose rather than a column of words. */
export const TAB_PREVIEW_WIDTH_PX = 420;

/** Air between the tab and the card. */
const GAP_PX = 8;

/** Air the card keeps to the edges of the screen. */
const EDGE_PX = 12;

/** Below this a side is too cramped to read a prompt in, so the other wins. */
const MIN_ROOM_PX = 160;

export interface TabRect {
  top: number;
  bottom: number;
  left: number;
}

export interface PreviewViewport {
  width: number;
  height: number;
}

export interface TabPreviewPlacement {
  left: number;
  /** Set when the card hangs below the tab; `bottom` is null then. */
  top: number | null;
  /** Set when the card sits above the tab; `top` is null then. */
  bottom: number | null;
  /** Room the card may claim before its prompt starts scrolling. */
  maxHeight: number;
}

export function placeTabPreview(tab: TabRect, viewport: PreviewViewport): TabPreviewPlacement {
  const rightmost = viewport.width - TAB_PREVIEW_WIDTH_PX - EDGE_PX;
  // A viewport narrower than the card leaves nothing to clamp into; pinning
  // the left edge at least keeps the beginning of the prompt readable.
  const left = Math.max(0, Math.min(tab.left, Math.max(EDGE_PX, rightmost)));

  const roomBelow = viewport.height - tab.bottom - GAP_PX - EDGE_PX;
  const roomAbove = tab.top - GAP_PX - EDGE_PX;

  if (roomBelow >= MIN_ROOM_PX || roomBelow >= roomAbove) {
    return { left, top: tab.bottom + GAP_PX, bottom: null, maxHeight: Math.max(roomBelow, 0) };
  }
  return {
    left,
    top: null,
    bottom: viewport.height - tab.top + GAP_PX,
    maxHeight: Math.max(roomAbove, 0),
  };
}
