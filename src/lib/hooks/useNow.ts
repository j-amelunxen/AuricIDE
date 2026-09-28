import { useSyncExternalStore } from 'react';

const INTERVAL_MS = 1000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function startTimer() {
  if (timer !== null) return;
  timer = setInterval(() => {
    now = Date.now();
    for (const listener of listeners) {
      listener();
    }
  }, INTERVAL_MS);
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopTimer();
  };
}

function getSnapshot(): number {
  return now;
}

/** Shared 1-second timer — one interval for all consumers. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The shared clock, for a component that only cares about what the time
 * *means*: it re-renders when `signature(now)` changes, not every second.
 *
 * A panel that derives state from the clock (live, stalled, needs attention)
 * would otherwise re-render — and recompute its lists — once a second while
 * that state stays the same for minutes. Put the per-second text (a running
 * duration) in a leaf that calls `useNow` itself.
 *
 * `signature` must return a primitive; the returned time is the latest tick,
 * so everything computed from it agrees with the signature that was compared.
 */
export function useNowWhen(signature: (now: number) => string | number | boolean): number {
  const read = () => signature(now);
  useSyncExternalStore(subscribe, read, read);
  return now;
}
