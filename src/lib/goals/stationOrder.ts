import type { PmGoalStation } from '../tauri/goals';

/**
 * The two reorder invariants live here and nowhere else, imported by both
 * the frontend slice and the MCP tools so they cannot drift between
 * runtimes:
 *
 *   1. Done work is history — no pending station may move before it.
 *   2. The terminus stays last — enforced structurally: the terminus is the
 *      goal itself, never a station row, so there is nothing to reorder.
 *
 * All functions are pure: inputs untouched, re-numbered copies returned.
 */

/** The goal's stations in line order. */
export function orderedStations(stations: PmGoalStation[], goalId: string): PmGoalStation[] {
  return stations
    .filter((s) => s.goalId === goalId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/** Renumbers the goal's stations 0..n in their current order. */
export function normalizeSortOrders(stations: PmGoalStation[], goalId: string): PmGoalStation[] {
  const ordered = orderedStations(stations, goalId);
  const orderOf = new Map(ordered.map((s, i) => [s.id, i]));
  return stations.map((s) =>
    s.goalId === goalId ? { ...s, sortOrder: orderOf.get(s.id) ?? s.sortOrder } : s
  );
}

/**
 * Moves a station to `toIndex` within its line, clamped so nothing pending
 * ever lands before the last done station. An out-of-range or unknown target
 * is a no-op — reordering must never corrupt a line.
 */
export function moveStation(
  stations: PmGoalStation[],
  goalId: string,
  stationId: string,
  toIndex: number
): PmGoalStation[] {
  const ordered = orderedStations(stations, goalId);
  const fromIndex = ordered.findIndex((s) => s.id === stationId);
  if (fromIndex === -1) return stations;

  const without = ordered.filter((s) => s.id !== stationId);
  const lastDoneIndex = without.reduce((last, s, i) => (s.status === 'done' ? i : last), -1);
  const floor = ordered[fromIndex].status === 'done' ? 0 : lastDoneIndex + 1;
  const clamped = Math.max(floor, Math.min(toIndex, without.length));

  const next = [...without.slice(0, clamped), ordered[fromIndex], ...without.slice(clamped)];
  const orderOf = new Map(next.map((s, i) => [s.id, i]));
  return stations.map((s) =>
    s.goalId === goalId ? { ...s, sortOrder: orderOf.get(s.id) ?? s.sortOrder } : s
  );
}

/**
 * Inserts a human step at the end of the planned segment (before any fog):
 * a call, an email, a decision — machines cannot see it, so adding it must
 * cost one line of typing and nothing more.
 */
export function insertHumanStation(
  stations: PmGoalStation[],
  goalId: string,
  name: string,
  id: string,
  now: string
): PmGoalStation[] {
  const ordered = orderedStations(stations, goalId);
  const firstFog = ordered.findIndex((s) => s.status === 'fog');
  const insertAt = firstFog === -1 ? ordered.length : firstFog;

  const station: PmGoalStation = {
    id,
    goalId,
    name,
    kind: 'human',
    status: 'planned',
    evidenceKind: 'human',
    predicate: { type: 'human' },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: insertAt,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const next = [...ordered.slice(0, insertAt), station, ...ordered.slice(insertAt)];
  const orderOf = new Map(next.map((s, i) => [s.id, i]));
  return [
    ...stations.map((s) =>
      s.goalId === goalId ? { ...s, sortOrder: orderOf.get(s.id) ?? s.sortOrder } : s
    ),
    { ...station, sortOrder: orderOf.get(id)! },
  ];
}
