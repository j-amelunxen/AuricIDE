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

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The draft phase: dump what's in your head, see the proposed line, refine
 * it round by round, then start it. Nothing reaches the board until you say
 * go — the draft lives in its own kv namespace and survives a restart.
 */
export function PlannerPanel() {
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
      setGraph(draft.graph);
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

  const propose = useCallback(async () => {
    if (!goal || !rootPath || !dump.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await llmCall({
        messages: buildInitialPrompt(goal, dump.trim()),
        projectPath: rootPath,
      });
      const parsed = parsePlannerGraph(response.content);
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
      const next = applyPlannerOps(graph, ops);
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
    if (!goal || !graph || !rootPath) return;
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
        now: Date.now(),
      },
      goal.id
    );
  }, [goal, graph]);

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
              No LLM configured — set an API key in Settings to use the planner.
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
                placeholder="Dump what's in your head. Unstructured is fine — whatever you don't say stays in the fog."
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
                  {graph.stations.length} stations — not on the board until you start it
                </span>
              </div>
              <div data-testid="planner-preview" className="rounded-xl bg-black/20 px-2 py-1">
                <GoalLineMap line={previewLine} agentsById={new Map()} />
              </div>

              <div className="flex gap-2">
                <input
                  data-testid="planner-refine"
                  type="text"
                  value={refine}
                  onChange={(e) => setRefine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyRefinement();
                  }}
                  disabled={busy}
                  placeholder="Tell the planner what to change, Enter applies"
                  className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground-muted/40 focus:bg-black/50"
                />
                <button
                  data-testid="planner-apply"
                  onClick={() => void applyRefinement()}
                  disabled={busy || !refine.trim()}
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  {busy ? '…' : 'Apply'}
                </button>
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
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20"
                >
                  Start this line
                </button>
              </div>
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
