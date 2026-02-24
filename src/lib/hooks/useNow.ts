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
