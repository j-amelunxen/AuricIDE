import { useEffect, useMemo, useState } from 'react';
import type { Notification } from '@/lib/notifications/types';
import {
  firedRuns,
  formatUtcStamp,
  runsInRange,
  upcomingRuns,
  type ScheduleRun,
} from '@/lib/notifications/scheduleCalendar';
import {
  schedulesOccurrences,
  type Schedule,
  type ScheduleOccurrences,
} from '@/lib/tauri/schedules';

/** Per schedule. A view that needs more than this is a view nobody can read. */
export const RUNS_PER_SCHEDULE = 200;

const HOUR = 3_600_000;

export interface ScheduleRunsResult {
  runs: ScheduleRun[];
  /** Some schedule has more runs in the window than were fetched. */
  truncated: boolean;
  /** The future half could not be computed (backend missing or refused). */
  futureFailed: boolean;
}

interface Fetched {
  key: string;
  occurrences: ScheduleOccurrences[];
  failed: boolean;
}

/**
 * The runs to draw in `[from, to)`: past ones from the notifications the
 * schedules raised, future ones from the backend's occurrence walk.
 *
 * The fetch window starts at the current hour, not at `now`, so the effect
 * does not re-run every second; runs between that hour and `now` are dropped
 * by `upcomingRuns`.
 */
export function useScheduleRuns(
  schedules: Schedule[],
  notifications: Notification[],
  from: number,
  to: number,
  now: number
): ScheduleRunsResult {
  const fetchFrom = Math.max(from, Math.floor(now / HOUR) * HOUR);
  const enabled = useMemo(() => schedules.filter((schedule) => schedule.enabled), [schedules]);
  const wantsFuture = to > fetchFrom && enabled.length > 0;
  const requestKey = `${fetchFrom}:${to}`;
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (!wantsFuture) return;
    let current = true;
    schedulesOccurrences(enabled, formatUtcStamp(fetchFrom), formatUtcStamp(to), RUNS_PER_SCHEDULE)
      .then((occurrences) => {
        if (current) setFetched({ key: requestKey, occurrences, failed: false });
      })
      .catch(() => {
        if (current) setFetched({ key: requestKey, occurrences: [], failed: true });
      });
    return () => {
      current = false;
    };
  }, [enabled, wantsFuture, fetchFrom, to, requestKey]);

  const past = useMemo(
    () => runsInRange(firedRuns(notifications, schedules), from, Math.min(to, now + 1)),
    [notifications, schedules, from, to, now]
  );

  // A result for another window is stale; showing it would draw last week's runs on this week.
  const fresh = fetched !== null && fetched.key === requestKey ? fetched : null;
  const future = useMemo(
    () => (fresh === null ? [] : runsInRange(upcomingRuns(fresh.occurrences, now), from, to)),
    [fresh, now, from, to]
  );

  return {
    runs: [...past, ...future],
    truncated: fresh?.occurrences.some((entry) => entry.truncated) ?? false,
    futureFailed: fresh?.failed ?? false,
  };
}
