/**
 * Collects agent output chunks and hands them to the store at most once per
 * frame, all agents together.
 *
 * The backend emits a chunk per agent roughly every 32 ms, and a TUI agent
 * redraws a spinner the whole time it works. Appending each chunk on its own
 * meant a store update — and every store listener, the terminal mirrors, the
 * console memos — thirty times a second per agent. A frame is the finest
 * grain anything on screen can show, so nothing visible is lost by waiting
 * for it.
 *
 * `requestAnimationFrame` does not fire while the window is hidden, so a
 * timer races the frame; whichever comes first flushes and cancels the other.
 * Anything that must see the output first — above all a status change, whose
 * error toast reads the log tail — calls `flush()` before acting.
 *
 * While the window is hidden nothing is deferred at all. Nothing paints then,
 * so there is no frame to wait for, and WebKit throttles timers in a hidden
 * page to a second or more — the needs-input state and with it the dock
 * title's "(N)" count, which exist to be read exactly then, would lag by that
 * much. Appending per chunk is what hidden windows always did.
 */
/**
 * Per agent, its pending chunks in order and when each one arrived. The
 * arrival time is what a chunk was stamped with before batching; keeping it
 * keeps the feed's cross-agent order exactly as it was.
 */
export type OutputBatch = Array<[agentId: string, chunks: string[], arrivedAt: number[]]>;

export interface OutputBatcher {
  push: (agentId: string, chunk: string) => void;
  /** Hand over everything pending now. A no-op when nothing is pending. */
  flush: () => void;
}

export interface OutputBatcherScheduler {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (cb: () => void) => number;
  clearTimer: (id: number) => void;
  now?: () => number;
  /** True while nothing is painted, so batching buys nothing. */
  isHidden?: () => boolean;
}

/** Longest a chunk waits when frames are parked (hidden or occluded window). */
export const OUTPUT_FLUSH_FALLBACK_MS = 100;

const browserScheduler: OutputBatcherScheduler = {
  requestFrame: (cb) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : -1,
  cancelFrame: (id) => {
    if (id !== -1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  },
  setTimer: (cb) => window.setTimeout(cb, OUTPUT_FLUSH_FALLBACK_MS),
  clearTimer: (id) => window.clearTimeout(id),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
};

export function createOutputBatcher(
  onBatch: (batch: OutputBatch) => void,
  scheduler: OutputBatcherScheduler = browserScheduler
): OutputBatcher {
  // Map keeps first-seen order per batch; chunk order within an agent is kept
  // by the array. Order across agents never mattered: each has its own log.
  let pending = new Map<string, [chunks: string[], arrivedAt: number[]]>();
  const now = scheduler.now ?? Date.now;
  let frameId: number | null = null;
  let timerId: number | null = null;

  const flush = (): void => {
    if (frameId !== null) scheduler.cancelFrame(frameId);
    if (timerId !== null) scheduler.clearTimer(timerId);
    frameId = null;
    timerId = null;
    if (pending.size === 0) return;
    const batch: OutputBatch = Array.from(pending, ([id, [chunks, at]]) => [id, chunks, at]);
    pending = new Map();
    onBatch(batch);
  };

  return {
    push: (agentId, chunk) => {
      const at = now();
      const entry = pending.get(agentId);
      if (entry) {
        entry[0].push(chunk);
        entry[1].push(at);
      } else {
        pending.set(agentId, [[chunk], [at]]);
      }
      if (scheduler.isHidden?.()) {
        flush();
        return;
      }
      if (frameId === null && timerId === null) {
        frameId = scheduler.requestFrame(flush);
        timerId = scheduler.setTimer(flush);
      }
    },
    flush,
  };
}
