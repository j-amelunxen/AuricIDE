import { resizeShell } from '@/lib/tauri/terminal';

/** Delay after the last container resize before refitting, so a drag fits once. */
const REFIT_DELAY_MS = 50;

interface Fittable {
  fit(): void;
}

/** xterm's fit throws while the container has no size (hidden, detached); the next resize fits then. */
export function safeFit(fitAddon: Fittable | null | undefined): void {
  try {
    fitAddon?.fit();
  } catch {
    /* no size yet */
  }
}

/** Refits whenever the container's size settles. Returns the disposer. */
export function observeFit(container: Element, fitAddon: Fittable): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => safeFit(fitAddon), REFIT_DELAY_MS);
  });
  observer.observe(container);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}

/**
 * Sends every size the terminal takes to its PTY. A refused resize changes
 * nothing on screen; the next fit sends the size again.
 */
export function forwardResizeToPty(
  term: { onResize(listener: (size: { rows: number; cols: number }) => void): unknown },
  ptyId: string
): void {
  term.onResize(({ rows, cols }) => {
    resizeShell(ptyId, rows, cols).catch(() => {});
  });
}
