'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { llmCall } from '@/lib/tauri/llm';
import { getRootGoals } from '@/lib/store/goalsSlice';
import { buildGoalLine } from '@/lib/goals/goalLinesLayout';
import { buildInitialPrompt, buildRefinePrompt } from '@/lib/goals/planner/plannerPrompt';
import {
  parsePlannerGraph,
  parsePlannerOps,
  type PlannerGraph,
} from '@/lib/goals/planner/plannerSchema';
import { applyPlannerOps } from '@/lib/goals/planner/applyPlannerOps';
import { planToStations } from '@/lib/goals/planner/commitPlan';
import {
  deletePlannerDraft,
  loadPlannerDraft,
  savePlannerDraft,
  type PlannerRevision,
} from '@/lib/goals/planner/plannerDraft';
import { GoalLineMap } from './GoalLineMap';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PlannerStation } from '@/lib/goals/planner/plannerSchema';
import type { StationPredicate } from '@/lib/tauri/goals';
import { useNow } from '@/lib/hooks/useNow';

const EDITABLE_PREDICATES = ['undefined', 'human', 'file_exists', 'git_touches', 'judged'] as const;

function defaultPredicate(type: (typeof EDITABLE_PREDICATES)[number]): StationPredicate {
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

function evidenceForPredicate(type: StationPredicate['type']) {
  if (type === 'human') return 'human' as const;
  if (type === 'judged') return 'judged' as const;
  if (type === 'file_exists' || type === 'git_touches') return 'proof' as const;
  return 'claim' as const;
}

function stationForEvidence(
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

function withDraftIds(graph: PlannerGraph): PlannerGraph {
  return {
    stations: graph.stations.map((station) =>
      station.draftId ? station : { ...station, draftId: crypto.randomUUID() }
    ),
  };
}

function stationProblem(station: PlannerStation): string | null {
  if (!station.name.trim()) return 'Every station needs a name.';
  if (
    station.kind === 'human' &&
    (station.evidenceKind !== 'human' || station.predicate.type !== 'human')
  )
    return `“${station.name}” has inconsistent human evidence.`;
  if (
    station.kind !== 'human' &&
    (station.evidenceKind === 'human' || station.predicate.type === 'human')
  )
    return `“${station.name}” has human evidence but is not a human station.`;
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

function predicateValueProblem(station: PlannerStation): boolean {
  return (
    (station.predicate.type === 'file_exists' && !station.predicate.glob.trim()) ||
    (station.predicate.type === 'git_touches' && !station.predicate.pathPrefix.trim()) ||
    (station.predicate.type === 'judged' && !station.predicate.prompt.trim())
  );
}

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The draft phase: dump what's in your head, see the proposed line, refine
 * it round by round, then start it. Nothing reaches the board until you say
 * go — the draft lives in its own kv namespace and survives a restart.
 */
export function PlannerPanel() {
  const now = useNow();
  const rootPath = useStore((s) => s.rootPath);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const goalStationsDraft = useStore((s) => s.goalStationsDraft);
  const addStation = useStore((s) => s.addStation);
  const updateGoal = useStore((s) => s.updateGoal);
  const saveGoals = useStore((s) => s.saveGoals);
  const llmConfigured = useStore((s) => s.llmConfigured);

  const [open, setOpen] = useState(false);
  const [goalId, setGoalId] = useState('');
  const [dump, setDump] = useState('');
  const [refine, setRefine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<PlannerGraph | null>(null);
  const [revisions, setRevisions] = useState<PlannerRevision[]>([]);

  // Only goals without a committed plan are plannable — a line that already
  // has stations is refined on the board, not re-planned from scratch.
  const plannedGoalIds = useMemo(
    () => new Set(goalStationsDraft.map((s) => s.goalId)),
    [goalStationsDraft]
  );
  const plannableGoals = useMemo(
    () =>
      getRootGoals(goalsDraft).filter(
        (g) => g.status !== 'archived' && g.status !== 'achieved' && !plannedGoalIds.has(g.id)
      ),
    [goalsDraft, plannedGoalIds]
  );
  const goal = plannableGoals.find((g) => g.id === goalId) ?? null;

  // Selecting a goal resumes its persisted draft, if one exists.
  useEffect(() => {
    if (!rootPath || !goalId) return;
    let cancelled = false;
    void loadPlannerDraft(rootPath, goalId).then((draft) => {
      if (cancelled || !draft) return;
      setGraph(withDraftIds(draft.graph));
      setRevisions(draft.revisions);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath, goalId]);

  const persistDraft = useCallback(
    (nextGraph: PlannerGraph, nextRevisions: PlannerRevision[]) => {
      if (rootPath && goalId) {
        void savePlannerDraft(rootPath, goalId, { graph: nextGraph, revisions: nextRevisions });
      }
    },
    [rootPath, goalId]
  );

  const editGraph = useCallback(
    (change: (current: PlannerGraph) => PlannerGraph) => {
      if (!graph) return;
      const next = change(graph);
      setGraph(next);
      persistDraft(next, revisions);
    },
    [graph, persistDraft, revisions]
  );

  const propose = useCallback(async () => {
    if (!goal || !rootPath || !dump.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await llmCall({
        messages: buildInitialPrompt(goal, dump.trim()),
        projectPath: rootPath,
      });
      const parsed = withDraftIds(parsePlannerGraph(response.content));
      setGraph(parsed);
      setRevisions([]);
      persistDraft(parsed, []);
    } catch (e) {
      // The model's bad JSON is a normal event: the error shows verbatim,
      // the previous state stays, Retry is one click.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [goal, rootPath, dump, busy, persistDraft]);

  const applyRefinement = useCallback(async () => {
    if (!goal || !rootPath || !graph || !refine.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await llmCall({
        messages: buildRefinePrompt(graph, refine.trim()),
        projectPath: rootPath,
      });
      const ops = parsePlannerOps(response.content);
      const next = withDraftIds(applyPlannerOps(graph, ops));
      const nextRevisions = [...revisions, { instruction: refine.trim(), at: nowTimestamp() }];
      setGraph(next);
      setRevisions(nextRevisions);
      setRefine('');
      persistDraft(next, nextRevisions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [goal, rootPath, graph, refine, busy, revisions, persistDraft]);

  const reset = useCallback(() => {
    setGraph(null);
    setRevisions([]);
    setDump('');
    setRefine('');
    setError(null);
  }, []);

  const discard = useCallback(() => {
    if (rootPath && goalId) void deletePlannerDraft(rootPath, goalId);
    reset();
  }, [rootPath, goalId, reset]);

  const start = useCallback(() => {
    if (!goal || !graph || !rootPath || graph.stations.some(stationProblem)) return;
    const stations = planToStations(graph, goal.id, () => crypto.randomUUID(), nowTimestamp());
    for (const station of stations) addStation(station);
    if (goal.status === 'draft') updateGoal(goal.id, { status: 'active' });
    void saveGoals(rootPath);
    void deletePlannerDraft(rootPath, goal.id);
    reset();
    setGoalId('');
    setOpen(false);
  }, [goal, graph, rootPath, addStation, updateGoal, saveGoals, reset]);

  // The preview IS the commit result: same conversion, deterministic ids.
  const previewLine = useMemo(() => {
    if (!goal || !graph) return null;
    let n = 0;
    const stations = planToStations(graph, goal.id, () => `preview-${++n}`, nowTimestamp());
    return buildGoalLine(
      {
        goals: [goal],
        tickets: [],
        dependencies: [],
        requirements: [],
        requirementLinks: [],
        stations,
        runs: [],
        agents: [],
        now,
      },
      goal.id
    );
  }, [goal, graph, now]);
  const validation = graph?.stations.map(stationProblem).find(Boolean) ?? null;

  return (
    <div
      data-testid="planner-panel"
      className="rounded-2xl border border-white/5 bg-white/[0.02] p-4"
    >
      <button
        data-testid="planner-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <AuricIcon name="alt_route" aria-hidden="true" className="text-base text-primary-light" />
        <span className="text-xs font-bold text-foreground">Plan a line</span>
        <span className="text-[10px] text-foreground-muted">dump → proposal → refine → start</span>
        <span aria-hidden="true" className="ml-auto font-mono text-[10px] text-foreground-muted">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {!llmConfigured && (
            <p className="text-[11px] text-[#ffce2e]">
              No LLM configured. Set an API key in Settings to use the planner.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="planner-goal"
              className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60"
            >
              goal
            </label>
            <select
              id="planner-goal"
              data-testid="planner-goal-select"
              value={goalId}
              onChange={(e) => {
                setGoalId(e.target.value);
                reset();
              }}
              className="rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
            >
              <option value="">Pick a goal without a plan…</option>
              {plannableGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {goal && !graph && (
            <>
              <textarea
                data-testid="planner-dump"
                value={dump}
                onChange={(e) => setDump(e.target.value)}
                spellCheck={false}
                placeholder="Rough notes. Unstructured is fine."
                className="min-h-[110px] w-full resize-y rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none placeholder:text-foreground-muted/40 focus:bg-black/50"
              />
              <div className="flex justify-end">
                <button
                  data-testid="planner-propose"
                  onClick={() => void propose()}
                  disabled={busy || !dump.trim() || !llmConfigured}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20 disabled:opacity-40"
                >
                  {busy ? 'Planning…' : 'Propose plan'}
                </button>
              </div>
            </>
          )}

          {goal && graph && previewLine && (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#ffce2e]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#ffce2e]">
                  draft · v{revisions.length + 1}
                </span>
                <span className="text-[10px] text-foreground-muted">
                  {graph.stations.length} stations · not started yet
                </span>
              </div>
              <div data-testid="planner-preview" className="rounded-xl bg-black/20 px-2 py-1">
                <GoalLineMap line={previewLine} agentsById={new Map()} />
              </div>

              <div className="flex flex-col gap-2" aria-label="Edit draft stations">
                {graph.stations.map((station, index) => (
                  <fieldset
                    key={station.draftId}
                    className="rounded-xl border border-white/5 bg-black/20 p-2"
                  >
                    <legend className="px-1 font-mono text-[9px] text-foreground-muted">
                      station {index + 1}
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                      <input
                        data-testid={`planner-station-name-${index}`}
                        aria-label={`Station ${index + 1} name`}
                        aria-invalid={station.name.trim() ? undefined : true}
                        aria-describedby={station.name.trim() ? undefined : 'planner-validation'}
                        value={station.name}
                        onChange={(e) =>
                          editGraph((g) => ({
                            stations: g.stations.map((s, i) =>
                              i === index ? { ...s, name: e.target.value } : s
                            ),
                          }))
                        }
                        className="col-span-2 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground"
                      />
                      <select
                        data-testid={`planner-station-kind-${index}`}
                        aria-label={`Station ${index + 1} kind`}
                        value={station.kind}
                        onChange={(e) =>
                          editGraph((g) => ({
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
                        <option value="normal">normal</option>
                        <option value="gate">gate</option>
                        <option value="human">human</option>
                      </select>
                      <select
                        data-testid={`planner-station-evidence-${index}`}
                        aria-label={`Station ${index + 1} evidence`}
                        value={station.evidenceKind}
                        disabled={station.kind === 'human'}
                        onChange={(e) =>
                          editGraph((g) => ({
                            stations: g.stations.map((s, i) =>
                              i === index
                                ? stationForEvidence(
                                    s,
                                    e.target.value as PlannerStation['evidenceKind']
                                  )
                                : s
                            ),
                          }))
                        }
                        className="min-h-6 rounded-lg bg-black/30 px-2 py-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50"
                      >
                        <option value="claim">claim</option>
                        <option value="proof">proof</option>
                        <option value="judged">judged</option>
                        <option value="human">human</option>
                      </select>
                      <select
                        data-testid={`planner-station-predicate-${index}`}
                        aria-label={`Station ${index + 1} predicate`}
                        value={station.predicate.type}
                        disabled={station.kind === 'human'}
                        onChange={(e) => {
                          const predicate = defaultPredicate(
                            e.target.value as (typeof EDITABLE_PREDICATES)[number]
                          );
                          editGraph((g) => ({
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
                            {type}
                          </option>
                        ))}
                      </select>
                      {(station.predicate.type === 'file_exists' ||
                        station.predicate.type === 'git_touches' ||
                        station.predicate.type === 'judged') && (
                        <input
                          data-testid={`planner-station-predicate-value-${index}`}
                          aria-label={`Station ${index + 1} predicate value`}
                          aria-invalid={predicateValueProblem(station) ? true : undefined}
                          aria-describedby={
                            predicateValueProblem(station) ? 'planner-validation' : undefined
                          }
                          value={
                            station.predicate.type === 'file_exists'
                              ? station.predicate.glob
                              : station.predicate.type === 'git_touches'
                                ? station.predicate.pathPrefix
                                : station.predicate.prompt
                          }
                          onChange={(e) => {
                            const value = e.target.value;
                            editGraph((g) => ({
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
                            editGraph((g) => ({
                              stations: g.stations.map((s, i) =>
                                i === index ? { ...s, fog: e.target.checked || undefined } : s
                              ),
                            }))
                          }
                        />{' '}
                        fog
                      </label>
                      <div className="ml-auto flex gap-1">
                        <button
                          data-testid={`planner-station-up-${index}`}
                          aria-label={`Move station ${index + 1} earlier`}
                          disabled={index === 0}
                          className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                          onClick={() =>
                            editGraph((g) => {
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
                          aria-label={`Move station ${index + 1} later`}
                          disabled={index === graph.stations.length - 1}
                          className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                          onClick={() =>
                            editGraph((g) => {
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
                          aria-label={`Remove station ${index + 1}`}
                          disabled={graph.stations.length === 1}
                          className="min-h-6 min-w-6 rounded focus-visible:ring-2 focus-visible:ring-primary/70"
                          onClick={() =>
                            editGraph((g) => ({
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
                    editGraph((g) => ({
                      stations: [
                        ...g.stations,
                        {
                          draftId: crypto.randomUUID(),
                          name: 'New station',
                          kind: 'normal',
                          evidenceKind: 'claim',
                          predicate: { type: 'undefined' },
                        },
                      ],
                    }))
                  }
                  className="min-h-6 self-start rounded-lg px-2 py-1 text-[10px] text-foreground-muted hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary/70"
                >
                  + Add station
                </button>
              </div>

              <div className="flex flex-col gap-1 text-[10px] text-foreground-muted">
                <label data-testid="planner-refine-label" htmlFor="planner-refine">
                  Reprompt the planner
                </label>
                <div className="flex gap-2">
                  <input
                    id="planner-refine"
                    data-testid="planner-refine"
                    type="text"
                    value={refine}
                    onChange={(e) => setRefine(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void applyRefinement();
                    }}
                    disabled={busy}
                    placeholder="Reprompt to refine… Enter to apply"
                    className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground-muted/40 focus:bg-black/50 focus-visible:ring-2 focus-visible:ring-primary/70"
                  />
                  <button
                    data-testid="planner-apply"
                    onClick={() => void applyRefinement()}
                    disabled={busy || !refine.trim()}
                    className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    {busy ? '…' : 'Reprompt'}
                  </button>
                </div>
              </div>

              {revisions.length > 0 && (
                <div className="flex flex-col gap-0.5 font-mono text-[10px] text-foreground-muted">
                  {revisions.map((r, i) => (
                    <span key={`${r.at}-${i}`}>
                      <span className="text-[#2effa5]/70">✓</span> v{i + 2}: {r.instruction}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-white/5 pt-2">
                <button
                  data-testid="planner-discard"
                  onClick={discard}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Discard draft
                </button>
                <button
                  data-testid="planner-start"
                  onClick={start}
                  disabled={!!validation}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20"
                >
                  Start this line
                </button>
              </div>
              {validation && (
                <p
                  id="planner-validation"
                  role="alert"
                  data-testid="planner-validation"
                  className="text-[10px] text-[#ffce2e]"
                >
                  {validation}
                </p>
              )}
            </>
          )}

          {error && (
            <p data-testid="planner-error" className="font-mono text-[10px] text-[#ff4a4a]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
