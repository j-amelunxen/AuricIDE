/**
 * Keeps the compositor ticking briefly after terminal output.
 *
 * WKWebView (Tauri's macOS webview) parks the compositor when nothing is
 * animating, so xterm's `requestAnimationFrame`-driven render can stall until
 * the next user interaction — the classic "I have to press Enter to see new
 * output" bug. Calling `nudge()` after each write keeps a short rAF loop alive
 * for `windowMs`, which keeps the compositor awake so xterm's render flushes
 * promptly. It self-stops once output goes quiet, so idle terminals cost nothing.
 */
export interface RenderKeepAlive {
  /** Call right after writing output; extends the keep-alive window. */
  nudge: () => void;
  /** Cancel any pending frame (call on unmount). */
  stop: () => void;
}

export function createRenderKeepAlive(
  raf: (cb: () => void) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
  now: () => number = () => Date.now(),
  windowMs = 400
): RenderKeepAlive {
  let deadline = 0;
  let rafId: number | null = null;

  const pump = (): void => {
    if (now() < deadline) {
      rafId = raf(pump);
    } else {
      rafId = null;
    }
  };

  return {
    nudge: () => {
      deadline = now() + windowMs;
      if (rafId === null) {
        rafId = raf(pump);
      }
    },
    stop: () => {
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      deadline = 0;
    },
  };
}
