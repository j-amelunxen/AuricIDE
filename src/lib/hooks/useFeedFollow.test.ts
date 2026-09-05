import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FEED_RENDER_LIMIT, FEED_REVEAL_STEP } from '@/lib/agents/feedWindow';
import { useFeedFollow, type UseFeedFollowResult } from './useFeedFollow';

/** A minimal stand-in for the scroll pane, with mutable metrics the test
 * can drive directly rather than rendering a real scrollable DOM node —
 * real `HTMLDivElement` declares these as read-only. */
interface MockScrollEl {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function makeScrollEl(overrides: Partial<MockScrollEl> = {}): MockScrollEl {
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, ...overrides };
}

interface FeedFollowProps {
  rowCount: number;
  contextKey: string;
  onGrowthSeen?: () => void;
}

function renderFeedFollow(initial: FeedFollowProps & { el?: MockScrollEl }) {
  const el = initial.el ?? makeScrollEl();
  const scrollRef = { current: el as unknown as HTMLDivElement };
  const rendered = renderHook<UseFeedFollowResult, FeedFollowProps>(
    (props) => useFeedFollow({ scrollRef, ...props }),
    {
      initialProps: {
        rowCount: initial.rowCount,
        contextKey: initial.contextKey,
        onGrowthSeen: initial.onGrowthSeen,
      },
    }
  );
  return { ...rendered, el, scrollRef };
}

/** Simulates the reader having scrolled away from the bottom, then tells
 * the hook about it — the same two steps a real scroll event produces. */
function scrollAwayFromBottom(el: MockScrollEl, onScroll: () => void) {
  el.scrollTop = 0;
  el.scrollHeight = 10_000;
  el.clientHeight = 200;
  act(() => onScroll());
}

describe('useFeedFollow mount', () => {
  it('starts following and pinned to the bottom', () => {
    const el = makeScrollEl({ scrollHeight: 4000 });
    const { result } = renderFeedFollow({ rowCount: 5, contextKey: 'a', el });

    expect(result.current.following).toBe(true);
    expect(result.current.revealedCount).toBe(FEED_RENDER_LIMIT);
    expect(el.scrollTop).toBe(4000);
  });
});

describe('useFeedFollow context reset', () => {
  it('resets the reveal window, resumes following and jumps to the bottom', () => {
    const el = makeScrollEl({ scrollHeight: 5000 });
    const { result, rerender } = renderFeedFollow({ rowCount: 1000, el, contextKey: 'a' });

    act(() => result.current.revealEarlier());
    expect(result.current.revealedCount).toBe(FEED_RENDER_LIMIT + FEED_REVEAL_STEP);
    scrollAwayFromBottom(el, result.current.onScroll);
    expect(result.current.following).toBe(false);

    el.scrollHeight = 7000;
    rerender({ rowCount: 1000, contextKey: 'b' });

    expect(result.current.revealedCount).toBe(FEED_RENDER_LIMIT);
    expect(result.current.following).toBe(true);
    expect(result.current.newCount).toBe(0);
    expect(el.scrollTop).toBe(7000);
  });
});

describe('useFeedFollow growth', () => {
  it('pins to the bottom and calls onGrowthSeen while following', () => {
    const el = makeScrollEl({ scrollHeight: 1000 });
    const onGrowthSeen = vi.fn();
    const { rerender } = renderFeedFollow({ rowCount: 1, contextKey: 'a', onGrowthSeen, el });

    el.scrollHeight = 1200;
    rerender({ rowCount: 2, contextKey: 'a', onGrowthSeen });

    expect(el.scrollTop).toBe(1200);
    expect(onGrowthSeen).toHaveBeenCalledTimes(1);
  });

  it('counts new rows and skips onGrowthSeen while not following', () => {
    const el = makeScrollEl();
    const onGrowthSeen = vi.fn();
    const { result, rerender } = renderFeedFollow({
      rowCount: 1,
      contextKey: 'a',
      onGrowthSeen,
      el,
    });

    scrollAwayFromBottom(el, result.current.onScroll);
    expect(result.current.following).toBe(false);

    rerender({ rowCount: 3, contextKey: 'a', onGrowthSeen });

    expect(result.current.newCount).toBe(2);
    expect(onGrowthSeen).not.toHaveBeenCalled();
  });
});

describe('useFeedFollow jumpToNew', () => {
  it('resumes following, clears the count and scrolls to the bottom', () => {
    const el = makeScrollEl();
    const { result, rerender } = renderFeedFollow({ rowCount: 1, contextKey: 'a', el });

    scrollAwayFromBottom(el, result.current.onScroll);
    rerender({ rowCount: 2, contextKey: 'a' });
    expect(result.current.newCount).toBe(1);

    el.scrollHeight = 12_000;
    act(() => result.current.jumpToNew());

    expect(result.current.following).toBe(true);
    expect(result.current.newCount).toBe(0);
    expect(el.scrollTop).toBe(12_000);
  });
});

describe('useFeedFollow revealEarlier', () => {
  it('grows the window and anchors scrollTop by exactly the height the reveal added', () => {
    const el = makeScrollEl({ scrollHeight: 6000 });
    const { result } = renderFeedFollow({ rowCount: 1000, contextKey: 'a', el });

    // The reader had scrolled up to read something before revealing more.
    el.scrollTop = 500;

    act(() => {
      result.current.revealEarlier();
      // The revealed rows land in the DOM above the fold before the
      // anchor-correcting effect gets to read the new scrollHeight.
      el.scrollHeight = 6800;
    });

    expect(result.current.revealedCount).toBe(FEED_RENDER_LIMIT + FEED_REVEAL_STEP);
    expect(el.scrollTop).toBe(500 + (6800 - 6000));
  });

  it('never reveals past the number of rows there are', () => {
    const { result } = renderFeedFollow({ rowCount: 350, contextKey: 'a' });

    act(() => result.current.revealEarlier());
    expect(result.current.revealedCount).toBe(350);

    act(() => result.current.revealEarlier());
    expect(result.current.revealedCount).toBe(350);
    expect(result.current.hiddenCount).toBe(0);
  });
});
