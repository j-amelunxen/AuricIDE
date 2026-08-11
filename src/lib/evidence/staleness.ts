import type { PmGoalStation } from '@/lib/tauri/goals';

/**
 * A machine check ages: a proof from three weeks ago is a memory, not a
 * proof. Mirrors the requirements staleness semantics (getStaleRequirements),
 * with a tighter window — code moves faster than requirements.
 */
export const STATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function parseTs(ts: string): number {
  return Date.parse(ts.replace(' ', 'T'));
}

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
    const checked = parseTs(s.lastCheckedAt);
    return !Number.isFinite(checked) || now - checked > staleMs;
  });
}
