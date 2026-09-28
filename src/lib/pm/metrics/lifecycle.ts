// ---------------------------------------------------------------------------
// Status lifecycle timing, independent of what the item is
// ---------------------------------------------------------------------------
//
// Tickets and goals both keep an append-only log of status changes. What the
// log means differs only in two places — which statuses finish the item and
// where the working spell behind a completion began — so those come in as a
// model and everything else is measured the same way.

import { parseHistoryTime } from './time';

export interface StatusChange {
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
}

export interface TimedChange extends StatusChange {
  at: number;
}

export interface LifecycleModel<T extends TimedChange = TimedChange> {
  /** Statuses that end the item's life as finished work. */
  completed: ReadonlySet<string>;
  /**
   * The event the cycle time is measured from, given every event up to and
   * including the completion, oldest first. Undefined when work never started.
   */
  cycleStart(untilCompletion: T[]): T | undefined;
}

export interface LifecycleTiming {
  /** Start of the working spell → completion. Null while unfinished. */
  cycleTime: number | null;
  /** Creation → completion. Null while unfinished or creation is unknown. */
  leadTime: number | null;
  /** Timestamp of the completion both times above are measured to. */
  completedAt: string | null;
  /** Milliseconds spent in each status the item has already left. */
  timeInStatus: Record<string, number>;
  currentStatus: string;
  /** How long the item has been sitting where it is now. */
  timeInCurrentStatus: number | null;
  /** When the item entered its current status. */
  currentStatusSince: string | null;
}

/** Oldest first. Equal stamps keep their given order. */
export function toTimed<T extends StatusChange>(entries: T[]): (T & { at: number })[] {
  return entries
    .map((entry) => ({ ...entry, at: parseHistoryTime(entry.changedAt) }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Timing for one item. `entries` must be that item's events, oldest first;
 * `now` pins the "still sitting here" figures in tests.
 */
export function computeLifecycle<T extends TimedChange>(
  entries: T[],
  currentStatus: string,
  model: LifecycleModel<T>,
  now: number
): LifecycleTiming {
  // Time in each status the item has already left. The status it is in now
  // has no closing event, so it is reported on its own rather than guessed at.
  const timeInStatus: Record<string, number> = {};
  for (let i = 0; i < entries.length - 1; i++) {
    const span = entries[i + 1].at - entries[i].at;
    if (span <= 0) continue;
    const status = entries[i].toStatus;
    timeInStatus[status] = (timeInStatus[status] ?? 0) + span;
  }

  const last = entries.at(-1) ?? null;
  const open = {
    cycleTime: null,
    leadTime: null,
    completedAt: null,
    timeInStatus,
    currentStatus,
    timeInCurrentStatus: last ? Math.max(now - last.at, 0) : null,
    currentStatusSince: last?.changedAt ?? null,
  };

  // The last completion — a reopened item is measured to the run that
  // actually finished it, never to an earlier one it was pulled back from.
  const completionIndex = model.completed.has(currentStatus)
    ? entries.findLastIndex((e) => model.completed.has(e.toStatus))
    : -1;
  if (completionIndex < 0) return open;

  const completion = entries[completionIndex];
  const creation = entries.find((e) => e.fromStatus === null);
  const started = model.cycleStart(entries.slice(0, completionIndex + 1));

  return {
    ...open,
    cycleTime: started ? completion.at - started.at : null,
    leadTime: creation ? completion.at - creation.at : null,
    completedAt: completion.changedAt,
  };
}
