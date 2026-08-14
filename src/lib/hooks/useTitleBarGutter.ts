'use client';

import { useEffect } from 'react';
import { isOverlayTitleBar, setTitleBarOverlay } from '@/lib/platform/titlebar';

/**
 * Keeps the header's traffic-light gutter in step with the window.
 *
 * The boot script in `layout.tsx` opens the gutter before the first paint,
 * which is right for a normal window and wrong for a fullscreen one: macOS
 * takes the title bar away in fullscreen and only slides the buttons in over
 * the page when the pointer reaches the top edge. Left alone, the header would
 * stay indented around nothing for as long as the window is fullscreen.
 *
 * Fullscreen has no event of its own in the webview, but it cannot happen
 * without a resize — so the resize is what this listens to, and the window's
 * own answer decides. Anywhere the overlay was never on (browser dev server,
 * Windows, Linux) this does nothing at all rather than reaching for a bridge
 * that is not there.
 */
export function useTitleBarGutter(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isOverlayTitleBar(window as Parameters<typeof isOverlayTitleBar>[0])) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();

        const sync = async () => {
          const fullscreen = await appWindow.isFullscreen();
          if (!disposed) setTitleBarOverlay(document.documentElement, !fullscreen);
        };

        await sync();
        const stop = await appWindow.onResized(() => void sync());
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // No window bridge — the boot script's mark stands as it is.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
