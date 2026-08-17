/**
 * Tracks the last keyboard/pointer input in the window, for the "is anyone
 * here" check a scheduled conductor run gates its automatic switches on
 * (`scheduledRunGate` in `src/lib/conductor/scheduledRun.ts`).
 *
 * Module-level state on purpose: the tracker is installed once, high in the
 * component tree, and read from wherever `idleForMs` is needed without
 * threading a value through props or the store.
 */

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel'] as const;

/** Writes closer together than this are the same burst of input, not two. */
const WRITE_THROTTLE_MS = 1_000;

let installedAt: number | null = null;
let lastUserInputAt: number | null = null;
let lastWriteAt = 0;

/**
 * Starts watching for input on `target` and returns a function that stops.
 *
 * The moment of installing counts as activity: a fresh launch with no input
 * yet must read as attended for the first `UNATTENDED_AFTER_MS`, not as
 * having been idle since the epoch.
 */
export function installUserActivityTracker(target: Window | Document): () => void {
  installedAt = Date.now();
  lastUserInputAt = null;
  lastWriteAt = 0;

  const onActivity = () => {
    const now = Date.now();
    if (now - lastWriteAt < WRITE_THROTTLE_MS) return;
    lastUserInputAt = now;
    lastWriteAt = now;
  };

  for (const type of ACTIVITY_EVENTS) {
    target.addEventListener(type, onActivity, { passive: true });
  }

  return () => {
    for (const type of ACTIVITY_EVENTS) {
      target.removeEventListener(type, onActivity);
    }
  };
}

/** Milliseconds since the last recorded input, or since install if there has been none. */
export function idleForMs(now: number = Date.now()): number {
  const reference = lastUserInputAt ?? installedAt;
  return reference === null ? 0 : now - reference;
}
