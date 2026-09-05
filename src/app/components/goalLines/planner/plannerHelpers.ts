import type { PlannerGraph, PlannerStation } from '@/lib/goals/planner/plannerSchema';
import type { StationPredicate } from '@/lib/tauri/goals';

export const EDITABLE_PREDICATES = [
  'undefined',
  'human',
  'file_exists',
  'git_touches',
  'judged',
] as const;

export function defaultPredicate(type: (typeof EDITABLE_PREDICATES)[number]): StationPredicate {
  switch (type) {
    case 'file_exists':
      return { type, glob: '' };
    case 'git_touches':
      return { type, pathPrefix: '' };
    case 'judged':
      return { type, prompt: '' };
    default:
      return { type };
  }
}

export function evidenceForPredicate(type: StationPredicate['type']) {
  if (type === 'human') return 'human' as const;
  if (type === 'judged') return 'judged' as const;
  if (type === 'file_exists' || type === 'git_touches') return 'proof' as const;
  return 'claim' as const;
}

export function stationForEvidence(
  station: PlannerStation,
  evidenceKind: PlannerStation['evidenceKind']
): PlannerStation {
  if (evidenceKind === 'human')
    return { ...station, kind: 'human', evidenceKind, predicate: { type: 'human' } };
  const predicate =
    evidenceKind === 'judged'
      ? defaultPredicate('judged')
      : evidenceKind === 'proof'
        ? defaultPredicate('file_exists')
        : defaultPredicate('undefined');
  return {
    ...station,
    kind: station.kind === 'human' ? 'normal' : station.kind,
    evidenceKind,
    predicate,
  };
}

export function withDraftIds(graph: PlannerGraph): PlannerGraph {
  return {
    stations: graph.stations.map((station) =>
      station.draftId ? station : { ...station, draftId: crypto.randomUUID() }
    ),
  };
}

export function stationProblem(station: PlannerStation): string | null {
  if (!station.name.trim()) return 'Every checkpoint needs a name.';
  if (
    station.kind === 'human' &&
    (station.evidenceKind !== 'human' || station.predicate.type !== 'human')
  )
    return `“${station.name}” has inconsistent human evidence.`;
  if (
    station.kind !== 'human' &&
    (station.evidenceKind === 'human' || station.predicate.type === 'human')
  )
    return `“${station.name}” has human evidence but is not a human checkpoint.`;
  if (evidenceForPredicate(station.predicate.type) !== station.evidenceKind)
    return `“${station.name}” evidence does not match its check.`;
  if (station.predicate.type === 'file_exists' && !station.predicate.glob.trim())
    return `“${station.name}” needs a file glob.`;
  if (station.predicate.type === 'git_touches' && !station.predicate.pathPrefix.trim())
    return `“${station.name}” needs a path prefix.`;
  if (station.predicate.type === 'judged' && !station.predicate.prompt.trim())
    return `“${station.name}” needs a judge prompt.`;
  return null;
}

export function predicateValueProblem(station: PlannerStation): boolean {
  return (
    (station.predicate.type === 'file_exists' && !station.predicate.glob.trim()) ||
    (station.predicate.type === 'git_touches' && !station.predicate.pathPrefix.trim()) ||
    (station.predicate.type === 'judged' && !station.predicate.prompt.trim())
  );
}

export function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
