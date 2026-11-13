import { parseUtcStamp } from '@/lib/time/utcStamp';
import type { PmGoalStation } from '@/lib/goals/types';

/**
 * A machine check ages: a proof from three weeks ago is a memory, not a
 * proof. Mirrors requirement freshness (`lib/pm/requirementFreshness`),
 * with a tighter window — code moves faster than requirements.
 */
export const STATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Done stations whose machine evidence has aged out. Human ticks never go
 * stale — a person's decision does not expire — and claims are already
 * drawn as unproven.
 */
export function staleStations(
  stations: PmGoalStation[],
  now: number,
  staleMs: number = STATION_STALE_MS
): PmGoalStation[] {
  return stations.filter((s) => {
    if (s.status !== 'done') return false;
    if (s.evidenceKind !== 'proof' && s.evidenceKind !== 'judged') return false;
    if (!s.lastCheckedAt) return true; // done as proof but never checked: stale by definition
    const checked = parseUtcStamp(s.lastCheckedAt);
    return checked === null || now - checked > staleMs;
  });
}
