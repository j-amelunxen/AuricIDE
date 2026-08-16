import { describe, expect, it } from 'vitest';
import {
  placeTabPreview,
  TAB_PREVIEW_DELAY_MS,
  TAB_PREVIEW_GRACE_MS,
  TAB_PREVIEW_WIDTH_PX,
} from './tabPreview';

const viewport = { width: 1440, height: 900 };

/** A tab near the top left, with the whole screen below it. */
const roomyTab = { top: 120, bottom: 148, left: 200 };

describe('placeTabPreview', () => {
  it('hangs the card under the tab it belongs to', () => {
    const placement = placeTabPreview(roomyTab, viewport);
    expect(placement.top).toBeGreaterThan(roomyTab.bottom);
    expect(placement.bottom).toBeNull();
    expect(placement.left).toBe(roomyTab.left);
  });

  it('keeps a rightmost tab card fully on screen', () => {
    const placement = placeTabPreview({ ...roomyTab, left: 1400 }, viewport);
    expect(placement.left + TAB_PREVIEW_WIDTH_PX).toBeLessThanOrEqual(viewport.width);
    expect(placement.left).toBeGreaterThan(0);
  });

  it('keeps a card on screen when the viewport is narrower than the card', () => {
    const placement = placeTabPreview({ ...roomyTab, left: 40 }, { width: 320, height: 900 });
    expect(placement.left).toBeGreaterThanOrEqual(0);
  });

  it('flips above the tab when the strip sits at the bottom of the screen', () => {
    const placement = placeTabPreview({ top: 820, bottom: 848, left: 200 }, viewport);
    expect(placement.top).toBeNull();
    expect(placement.bottom).toBeGreaterThan(viewport.height - 820);
  });

  it('gives the card the room the chosen side actually has', () => {
    const tall = placeTabPreview(roomyTab, viewport).maxHeight;
    const cramped = placeTabPreview(roomyTab, { width: 1440, height: 420 }).maxHeight;
    expect(tall).toBeGreaterThan(cramped);
    expect(cramped).toBeGreaterThan(0);
  });

  it('never reaches past the bottom of the screen', () => {
    const placement = placeTabPreview(roomyTab, viewport);
    expect((placement.top ?? 0) + placement.maxHeight).toBeLessThanOrEqual(viewport.height);
  });

  it('waits long enough that passing the pointer over a tab shows nothing', () => {
    // A dwell, not a brush past: shorter than this and the strip flickers
    // cards while the user is only aiming at another tab.
    expect(TAB_PREVIEW_DELAY_MS).toBeGreaterThanOrEqual(400);
    // The grace period only has to cover the gap between tab and card.
    expect(TAB_PREVIEW_GRACE_MS).toBeLessThan(TAB_PREVIEW_DELAY_MS);
  });
});
