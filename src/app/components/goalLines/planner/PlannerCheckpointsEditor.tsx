import type { PlannerGraph, PlannerStation } from '@/lib/goals/planner/plannerSchema';
import {
  EDITABLE_PREDICATES,
  defaultPredicate,
  evidenceForPredicate,
  predicateValueProblem,
  stationForEvidence,
} from './plannerHelpers';

interface PlannerCheckpointsEditorProps {
  graph: PlannerGraph;
  onEditGraph: (change: (current: PlannerGraph) => PlannerGraph) => void;
}

export function PlannerCheckpointsEditor({ graph, onEditGraph }: PlannerCheckpointsEditorProps) {
  return (
    <div className="flex flex-col gap-2" aria-label="Edit draft checkpoints">
      {graph.stations.map((station, index) => (
        <fieldset
          key={station.draftId}
          className="rounded-xl border border-white/5 bg-black/20 p-2"
        >
          <legend className="px-1 font-mono text-[9px] text-foreground-muted">
            checkpoint {index + 1}
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            <input
              data-testid={`planner-station-name-${index}`}
              aria-label={`Checkpoint ${index + 1} name`}
              aria-invalid={station.name.trim() ? undefined : true}
              aria-describedby={station.name.trim() ? undefined : 'planner-validation'}
              value={station.name}
              onChange={(e) =>
                onEditGraph((g) => ({
                  stations: g.stations.map((s, i) =>
                    i === index ? { ...s, name: e.target.value } : s
                  ),
                }))
              }
              className="col-span-2 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground"
            />
            <select
              data-testid={`planner-station-kind-${index}`}
              aria-label={`Checkpoint ${index + 1} kind`}
              value={station.kind}
              onChange={(e) =>
                onEditGraph((g) => ({
                  stations: g.stations.map((s, i) =>
                    i === index
                      ? e.target.value === 'human'
                        ? {
                            ...s,
                            kind: 'human',
                            evidenceKind: 'human',
                            predicate: { type: 'human' },
                          }
                        : s.kind === 'human'
                          ? {
                              ...s,
                              kind: e.target.value as PlannerStation['kind'],
                              evidenceKind: 'claim',
                              predicate: { type: 'undefined' },
                            }
                          : { ...s, kind: e.target.value as PlannerStation['kind'] }
                      : s
                  ),
                }))
              }
              className="min-h-6 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-primary/70"
            >
              <option value="normal">Step</option>
              <option value="gate">Review step</option>
              <option value="human">Your step</option>
            </select>
            <select
              data-testid={`planner-station-evidence-${index}`}
              aria-label={`Checkpoint ${index + 1} evidence`}
              value={station.evidenceKind}
              disabled={station.kind === 'human'}
              onChange={(e) =>
                onEditGraph((g) => ({
                  stations: g.stations.map((s, i) =>
                    i === index
                      ? stationForEvidence(s, e.target.value as PlannerStation['evidenceKind'])
                      : s
                  ),
                }))
              }
              className="min-h-6 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50"
            >
              <option value="claim">Reported</option>
              <option value="proof">Verified</option>
              <option value="judged">AI reviewed</option>
              <option value="human">Manual confirmation</option>
            </select>
            <select
              data-testid={`planner-station-predicate-${index}`}
              aria-label={`Checkpoint ${index + 1} predicate`}
              value={station.predicate.type}
              disabled={station.kind === 'human'}
              onChange={(e) => {
                const predicate = defaultPredicate(
                  e.target.value as (typeof EDITABLE_PREDICATES)[number]
                );
                onEditGraph((g) => ({
                  stations: g.stations.map((s, i) =>
                    i === index
                      ? {
                          ...s,
                          predicate,
                          evidenceKind: evidenceForPredicate(predicate.type),
                        }
                      : s
                  ),
                }));
              }}
              className="min-h-6 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50"
            >
              {EDITABLE_PREDICATES.map((type) => (
                <option key={type} value={type}>
                  {type === 'undefined'
                    ? 'No automatic check'
                    : type === 'human'
                      ? 'Manual confirmation'
                      : type === 'file_exists'
                        ? 'File exists'
                        : type === 'git_touches'
                          ? 'Files changed'
                          : 'AI review'}
                </option>
              ))}
            </select>
            {(station.predicate.type === 'file_exists' ||
              station.predicate.type === 'git_touches' ||
              station.predicate.type === 'judged') && (
              <input
                data-testid={`planner-station-predicate-value-${index}`}
                aria-label={`Checkpoint ${index + 1} predicate value`}
                aria-invalid={predicateValueProblem(station) ? true : undefined}
                aria-describedby={predicateValueProblem(station) ? 'planner-validation' : undefined}
                value={
                  station.predicate.type === 'file_exists'
                    ? station.predicate.glob
                    : station.predicate.type === 'git_touches'
                      ? station.predicate.pathPrefix
                      : station.predicate.prompt
                }
                onChange={(e) => {
                  const value = e.target.value;
                  onEditGraph((g) => ({
                    stations: g.stations.map((s, i) =>
                      i !== index
                        ? s
                        : s.predicate.type === 'file_exists'
                          ? { ...s, predicate: { type: 'file_exists', glob: value } }
                          : s.predicate.type === 'git_touches'
                            ? {
                                ...s,
                                predicate: { type: 'git_touches', pathPrefix: value },
                              }
                            : { ...s, predicate: { type: 'judged', prompt: value } }
                    ),
                  }));
                }}
                className="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-primary/70 sm:col-span-2"
              />
            )}
            <label className="flex min-h-6 items-center gap-1 text-[10px] text-foreground-muted focus-within:ring-2 focus-within:ring-primary/70">
              <input
                data-testid={`planner-station-fog-${index}`}
                type="checkbox"
                className="h-6 w-6"
                checked={station.fog === true}
                onChange={(e) =>
                  onEditGraph((g) => ({
                    stations: g.stations.map((s, i) =>
                      i === index ? { ...s, fog: e.target.checked || undefined } : s
                    ),
                  }))
                }
              />{' '}
              Mark as later
            </label>
            <div className="ml-auto flex gap-1">
              <button
                data-testid={`planner-station-up-${index}`}
                aria-label={`Move checkpoint ${index + 1} earlier`}
                disabled={index === 0}
                className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                onClick={() =>
                  onEditGraph((g) => {
                    const stations = [...g.stations];
                    const [item] = stations.splice(index, 1);
                    stations.splice(index - 1, 0, item);
                    return { stations };
                  })
                }
              >
                ↑
              </button>
              <button
                data-testid={`planner-station-down-${index}`}
                aria-label={`Move checkpoint ${index + 1} later`}
                disabled={index === graph.stations.length - 1}
                className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                onClick={() =>
                  onEditGraph((g) => {
                    const stations = [...g.stations];
                    const [item] = stations.splice(index, 1);
                    stations.splice(index + 1, 0, item);
                    return { stations };
                  })
                }
              >
                ↓
              </button>
              <button
                data-testid={`planner-station-remove-${index}`}
                aria-label={`Remove checkpoint ${index + 1}`}
                disabled={graph.stations.length === 1}
                className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                onClick={() =>
                  onEditGraph((g) => ({
                    stations: g.stations.filter((_, i) => i !== index),
                  }))
                }
              >
                ×
              </button>
            </div>
          </div>
        </fieldset>
      ))}
      <button
        data-testid="planner-add-station"
        onClick={() =>
          onEditGraph((g) => ({
            stations: [
              ...g.stations,
              {
                draftId: crypto.randomUUID(),
                name: 'New checkpoint',
                kind: 'normal',
                evidenceKind: 'claim',
                predicate: { type: 'undefined' },
              },
            ],
          }))
        }
        className="min-h-6 self-start rounded-lg px-2 py-1 text-[10px] text-foreground-muted hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary/70"
      >
        + Add checkpoint
      </button>
    </div>
  );
}
