/**
 * Keeps the compositor ticking briefly after terminal output.
 *
 * WKWebView (Tauri's macOS webview) parks the compositor when nothing is
 * animating, so xterm's `requestAnimationFrame`-driven render can stall until
 * the next user interaction — the classic "I have to press Enter to see new
 * output" bug. Calling `nudge()` after each write keeps a short rAF loop alive
 * for `windowMs`, which keeps the compositor awake so xterm's render flushes
 * promptly. It self-stops once output goes quiet, so idle terminals cost nothing.
 *
 * It also stops — and a write does not restart it — while the terminal cannot
 * be seen (`isVisible`): a background shell tab, a hidden window. Output kept
 * streaming into those, and each write held a 60 fps loop open for a screen
 * nobody was looking at. On a visible terminal a steady stream still keeps the
 * loop alive; there the screen really changes every few frames, so the frames
 * are being produced anyway and the loop only adds a no-op callback to each.
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
  windowMs = 400,
  isVisible: () => boolean = () => true
): RenderKeepAlive {
  let deadline = 0;
  let rafId: number | null = null;

  const pump = (): void => {
    if (now() < deadline && isVisible()) {
      rafId = raf(pump);
    } else {
      rafId = null;
    }
  };

  return {
    nudge: () => {
      if (!isVisible()) return;
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
