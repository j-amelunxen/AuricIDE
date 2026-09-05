'use client';

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FEED_RENDER_LIMIT, FEED_REVEAL_STEP } from '@/lib/agents/feedWindow';
import { isNearBottom } from '@/lib/agents/lanes';

export interface UseFeedFollowOptions {
  /** The scrollable pane whose position this hook reads and corrects. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** How many rows the caller currently has to show, in the active context. */
  rowCount: number;
  /** Identifies what is being shown — a filter, a mode, a selected lane.
   * Changing it resets the window and re-pins the pane to the bottom. */
  contextKey: string;
  /** Called when new rows arrive while the pane is following. The caller
   * decides whether that growth also means something was "seen". */
  onGrowthSeen?: () => void;
}

export interface UseFeedFollowResult {
  following: boolean;
  newCount: number;
  revealedCount: number;
  hiddenCount: number;
  onScroll: () => void;
  jumpToNew: () => void;
  revealEarlier: () => void;
}

/**
 * Owns the console feed's scroll bookkeeping: the reveal window, whether the
 * pane is following new rows to the bottom, the "N new ↓" count while it
 * isn't, and the anchor correction that keeps the viewport still when
 * "Show earlier" grows the content above it.
 *
 * `onGrowthSeen` is kept in a ref rather than a dependency so the effect that
 * calls it can list every value it actually reads — a caller that passes a
 * fresh closure on every render must not force the growth effect to re-run.
 */
export function useFeedFollow({
  scrollRef,
  rowCount,
  contextKey,
  onGrowthSeen,
}: UseFeedFollowOptions): UseFeedFollowResult {
  const [revealedCount, setRevealedCount] = useState(FEED_RENDER_LIMIT);
  const [following, setFollowing] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const prevContextRef = useRef<string | null>(null);
  const prevRowCountRef = useRef(0);
  const onGrowthSeenRef = useRef(onGrowthSeen);
  useLayoutEffect(() => {
    onGrowthSeenRef.current = onGrowthSeen;
  }, [onGrowthSeen]);

  // "Show N earlier" prepends rows above whatever the reader is looking at.
  // Left alone, the browser holds `scrollTop` steady while the content above
  // it grows, which reads as the viewport jumping down. Stashed here at
  // click time and corrected once the reveal has actually landed in the DOM.
  const pendingRevealAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingRevealAnchorRef.current;
    if (!pending) return;
    pendingRevealAnchorRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = pending.scrollTop + (el.scrollHeight - pending.scrollHeight);
  }, [revealedCount, scrollRef]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const contextChanged = prevContextRef.current !== contextKey;
    const prevRowCount = prevRowCountRef.current;
    prevContextRef.current = contextKey;
    prevRowCountRef.current = rowCount;

    if (contextChanged) {
      setRevealedCount(FEED_RENDER_LIMIT);
      setFollowing(true);
      setNewCount(0);
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }

    const delta = rowCount - prevRowCount;
    if (delta <= 0) return;
    if (following) {
      if (el) el.scrollTop = el.scrollHeight;
      onGrowthSeenRef.current?.();
    } else {
      setNewCount((n) => n + delta);
    }
  }, [rowCount, contextKey, following, scrollRef]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
    setFollowing(near);
    if (near) setNewCount(0);
  }, [scrollRef]);

  const jumpToNew = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
    setNewCount(0);
  }, [scrollRef]);

  const revealEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      pendingRevealAnchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
    }
    setRevealedCount((c) => Math.min(rowCount, c + FEED_REVEAL_STEP));
  }, [rowCount, scrollRef]);

  return {
    following,
    newCount,
    revealedCount,
    hiddenCount: Math.max(0, rowCount - revealedCount),
    onScroll,
    jumpToNew,
    revealEarlier,
  };
}
