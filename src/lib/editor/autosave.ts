/**
 * Debounced, serialized autosave for editor buffers.
 *
 * Writing on every keystroke is not just wasteful — it is unsafe. Concurrent
 * writes of the same file finish in whatever order the OS grants them, so a
 * slow write carrying older text can land after a fast one carrying newer
 * text and silently undo what the user just typed. And a write that fails has
 * nowhere to report to, which is how "it looked saved" happens.
 *
 * This queue guarantees three things per file: at most one write in flight,
 * writes land in the order they were issued, and only the newest pending text
 * is ever written (intermediate keystrokes are dropped, never reordered).
 */

/** Long enough to collapse a typing burst, short enough to feel immediate. */
export const AUTOSAVE_DELAY_MS = 400;

export interface AutosaveOptions {
  write: (path: string, content: string) => Promise<void>;
  /** Called after `content` is durably written and nothing newer is pending. */
  onSaved?: (path: string, content: string) => void;
  /** Called when a write fails. The text stays pending-free; the caller decides. */
  onError?: (path: string, error: unknown) => void;
  delayMs?: number;
}

export interface Autosave {
  /** Record new content for a path; writes after the debounce settles. */
  schedule: (path: string, content: string) => void;
  /** Write everything pending right now and resolve once it has landed. */
  flush: () => Promise<void>;
  /** Drop everything pending without writing it. */
  cancel: () => void;
}

interface FileQueue {
  /** Newest text not yet handed to a write, if any. */
  pending: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Resolves when the current write chain for this file is idle. */
  inFlight: Promise<void> | null;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const { write, onSaved, onError, delayMs = AUTOSAVE_DELAY_MS } = options;
  const queues = new Map<string, FileQueue>();

  const queueFor = (path: string): FileQueue => {
    let queue = queues.get(path);
    if (!queue) {
      queue = { pending: null, timer: null, inFlight: null };
      queues.set(path, queue);
    }
    return queue;
  };

  /** Drain a file's pending text, one write at a time, newest text last. */
  const drain = async (path: string, queue: FileQueue): Promise<void> => {
    while (queue.pending !== null) {
      const content = queue.pending;
      queue.pending = null;
      try {
        await write(path, content);
        // Newer text arrived meanwhile — reporting "saved" now would clear a
        // dirty marker that is still true.
        if (queue.pending === null) onSaved?.(path, content);
      } catch (error) {
        onError?.(path, error);
      }
    }
    queue.inFlight = null;
  };

  const start = (path: string): Promise<void> => {
    const queue = queueFor(path);
    if (queue.timer !== null) {
      clearTimeout(queue.timer);
      queue.timer = null;
    }
    if (queue.pending === null) return queue.inFlight ?? Promise.resolve();
    if (queue.inFlight) return queue.inFlight;
    queue.inFlight = drain(path, queue);
    return queue.inFlight;
  };

  return {
    schedule(path, content) {
      const queue = queueFor(path);
      queue.pending = content;
      if (queue.timer !== null) clearTimeout(queue.timer);
      queue.timer = setTimeout(() => {
        queue.timer = null;
        void start(path);
      }, delayMs);
    },

    async flush() {
      await Promise.all(Array.from(queues.keys()).map((path) => start(path)));
    },

    cancel() {
      for (const queue of queues.values()) {
        if (queue.timer !== null) clearTimeout(queue.timer);
        queue.timer = null;
        queue.pending = null;
      }
    },
  };
}
