import type { PmGoalStation } from '@/lib/tauri/goals';
import type { PlannerGraph } from './plannerSchema';

/**
 * Turns an accepted draft into station rows. Everything lands as
 * `planned` (or `fog` for explicitly uncertain steps) — "front" is derived
 * by the layout, so a freshly started line immediately shows its front at
 * the first pending station without anything being written for it.
 */
export function planToStations(
  graph: PlannerGraph,
  goalId: string,
  idFn: () => string,
  now: string
): PmGoalStation[] {
  return graph.stations.map((station, i) => ({
    id: idFn(),
    goalId,
    name: station.name,
    kind: station.kind,
    status: station.fog ? 'fog' : 'planned',
    evidenceKind: station.evidenceKind,
    predicate: station.predicate,
    evidenceNote: '',
    ...(station.sourceContext ? { sourceContext: station.sourceContext } : {}),
    ticketId: null,
    lane: 0,
    sortOrder: i,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
  }));
}
