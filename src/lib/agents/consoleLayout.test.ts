import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONSOLE_FEED_DEFAULT_HEIGHT,
  CONSOLE_FEED_KEY_STEP,
  CONSOLE_FEED_MIN_HEIGHT,
  clampFeedHeight,
  feedHeightForKey,
  maxFeedHeight,
  readFeedHeight,
  readProjectsCollapsed,
  writeFeedHeight,
  writeProjectsCollapsed,
} from './consoleLayout';

beforeEach(() => {
  localStorage.clear();
});

describe('maxFeedHeight', () => {
  it('leaves most of the window to the fleet', () => {
    // The feed is the ticker, not the subject: however far it is pulled up,
    // some of the project grid has to stay on screen.
    expect(maxFeedHeight(1000)).toBeLessThan(1000);
    expect(maxFeedHeight(1000)).toBeGreaterThan(CONSOLE_FEED_MIN_HEIGHT);
  });

  it('never returns less than the minimum, however short the window', () => {
    expect(maxFeedHeight(120)).toBe(CONSOLE_FEED_MIN_HEIGHT);
  });

  it('is unbounded before the window has been measured', () => {
    // Server render, or the first frame of a test environment that lays
    // nothing out: a measured-looking 0 must not collapse the feed.
    expect(maxFeedHeight(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('clampFeedHeight', () => {
  it('keeps a height that already fits', () => {
    expect(clampFeedHeight(240, 1000)).toBe(240);
  });

  it('holds the floor so the feed keeps showing rows', () => {
    expect(clampFeedHeight(10, 1000)).toBe(CONSOLE_FEED_MIN_HEIGHT);
  });

  it('holds the ceiling so the grid never disappears', () => {
    expect(clampFeedHeight(5000, 1000)).toBe(maxFeedHeight(1000));
  });

  it('rounds to whole pixels', () => {
    expect(clampFeedHeight(240.6, 1000)).toBe(241);
  });

  it('falls back to the default rather than trusting a non-number', () => {
    expect(clampFeedHeight(Number.NaN, 1000)).toBe(CONSOLE_FEED_DEFAULT_HEIGHT);
  });
});

describe('feedHeightForKey', () => {
  it('grows the feed on ArrowUp — the handle is its top edge', () => {
    expect(feedHeightForKey('ArrowUp', 200, 1000)).toBe(200 + CONSOLE_FEED_KEY_STEP);
  });

  it('shrinks it on ArrowDown', () => {
    expect(feedHeightForKey('ArrowDown', 200, 1000)).toBe(200 - CONSOLE_FEED_KEY_STEP);
  });

  it('clamps at both ends instead of running past them', () => {
    expect(feedHeightForKey('ArrowDown', CONSOLE_FEED_MIN_HEIGHT, 1000)).toBe(
      CONSOLE_FEED_MIN_HEIGHT
    );
    expect(feedHeightForKey('ArrowUp', maxFeedHeight(1000), 1000)).toBe(maxFeedHeight(1000));
  });

  it('returns to the default on Home', () => {
    expect(feedHeightForKey('Home', 400, 1000)).toBe(CONSOLE_FEED_DEFAULT_HEIGHT);
  });

  it('ignores keys it does not own, so they reach whatever else wants them', () => {
    expect(feedHeightForKey('Enter', 200, 1000)).toBeNull();
    expect(feedHeightForKey('ArrowLeft', 200, 1000)).toBeNull();
  });
});

describe('the stored feed height', () => {
  it('is the default until something is written', () => {
    expect(readFeedHeight()).toBe(CONSOLE_FEED_DEFAULT_HEIGHT);
  });

  it('survives a round trip', () => {
    writeFeedHeight(320);
    expect(readFeedHeight()).toBe(320);
  });

  it('reads a stored value that no longer fits back up to the floor', () => {
    writeFeedHeight(12);
    expect(readFeedHeight()).toBe(CONSOLE_FEED_MIN_HEIGHT);
  });

  it('ignores a value that is not a number', () => {
    localStorage.setItem('auric.agent-console.feed-height', 'tall');
    expect(readFeedHeight()).toBe(CONSOLE_FEED_DEFAULT_HEIGHT);
  });
});

describe('the stored project-list state', () => {
  it('starts expanded — the list is what the console is for', () => {
    expect(readProjectsCollapsed()).toBe(false);
  });

  it('survives a round trip in both directions', () => {
    writeProjectsCollapsed(true);
    expect(readProjectsCollapsed()).toBe(true);
    writeProjectsCollapsed(false);
    expect(readProjectsCollapsed()).toBe(false);
  });
});
