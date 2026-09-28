/**
 * Runs an async job one at a time. Whatever is submitted while a run is in
 * flight is merged into a single follow-up run instead of queueing one run
 * per submission.
 *
 * The file tree refresh needs this: a burst of saves used to start several
 * full refreshes side by side, each one re-rendering the IDE on its own.
 */
export function createCoalescingRunner<T>(
  run: (value: T) => Promise<void>,
  merge: (pending: T, next: T) => T
) {
  let running: Promise<void> | null = null;
  let pending: { value: T; done: Promise<void> } | null = null;

  const start = (value: T): Promise<void> => {
    const current = run(value).finally(() => {
      running = null;
      const next = pending;
      pending = null;
      if (next) void start(next.value);
    });
    running = current;
    return current;
  };

  return {
    submit(value: T): Promise<void> {
      if (!running) return start(value);
      if (pending) {
        pending.value = merge(pending.value, value);
        return pending.done;
      }
      const slot: { value: T; done: Promise<void> } = { value, done: Promise.resolve() };
      // `running` settles only after its `finally` has started the follow-up,
      // so by then `running` is the run that includes `value`.
      slot.done = running.catch(() => undefined).then(() => running ?? undefined);
      pending = slot;
      return slot.done;
    },
  };
}
