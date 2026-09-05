'use client';

import { GoalLineMap } from './GoalLineMap';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { usePlannerState } from './planner/usePlannerState';
import { PlannerCheckpointsEditor } from './planner/PlannerCheckpointsEditor';
import { PlannerRefineSection } from './planner/PlannerRefineSection';

/**
 * The draft phase: dump what's in your head, see the proposed line, refine
 * it round by round, then save it. Nothing reaches the board until you say
 * go — the draft lives in its own kv namespace and survives a restart.
 */
export function PlannerPanel() {
  const {
    llmConfigured,
    open,
    setOpen,
    goalId,
    setGoalId,
    plannableGoals,
    goal,
    graph,
    previewLine,
    dump,
    setDump,
    busy,
    saving,
    error,
    revisions,
    refine,
    setRefine,
    validation,
    propose,
    editGraph,
    applyRefinement,
    reset,
    discard,
    start,
  } = usePlannerState();

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
        <span className="text-xs font-bold text-foreground">Plan a goal</span>
        <span className="text-[10px] text-foreground-muted">notes → plan → refine → save</span>
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
                  {busy ? 'Planning…' : 'Create plan'}
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
                  {graph.stations.length} checkpoints · not saved yet
                </span>
              </div>
              <div data-testid="planner-preview" className="rounded-xl bg-black/20 px-2 py-1">
                <GoalLineMap line={previewLine} agentsById={new Map()} />
                <p className="px-2 pb-2 text-[10px] text-foreground-muted">
                  Saving this plan adds its steps. You can create tickets next.
                </p>
              </div>

              <PlannerCheckpointsEditor graph={graph} onEditGraph={editGraph} />

              <PlannerRefineSection
                refine={refine}
                onRefineChange={setRefine}
                onApplyRefine={() => void applyRefinement()}
                busy={busy}
                revisions={revisions}
              />

              <div className="flex justify-end gap-2 border-t border-white/5 pt-2">
                <button
                  data-testid="planner-discard"
                  onClick={discard}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Discard plan
                </button>
                <button
                  data-testid="planner-start"
                  onClick={() => void start()}
                  disabled={!!validation || saving}
                  className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20"
                >
                  {saving ? 'Saving…' : 'Save plan'}
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
