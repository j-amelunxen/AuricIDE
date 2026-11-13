'use client';

import { useEffect, useState } from 'react';

/** Below this width a side-by-side diff and a review's file list stop fitting next to the code. */
export const NARROW_WIDTH = 700;

/**
 * Whether an element is narrower than `threshold`, observed as it resizes.
 * Returns a callback ref so it works for elements that mount later. Without
 * ResizeObserver (tests, very old webviews) the element counts as wide.
 */
export function useNarrow(threshold = NARROW_WIDTH): {
  narrow: boolean;
  measureRef: (node: HTMLElement | null) => void;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < threshold);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, threshold]);

  return { narrow, measureRef: setNode };
}
