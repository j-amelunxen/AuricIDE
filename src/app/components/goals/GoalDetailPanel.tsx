'use client';

import { useMemo, useState } from 'react';
import type { PmGoal, PmGoalRequirementLink, PmGoalRun } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import { getGoalSatisfaction, getRunsForGoal } from '@/lib/store/goalsSlice';
import { GOAL_STATUS_STYLES } from './GoalTree';

const RUN_OUTCOME_STYLES: Record<string, string> = {
  running: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  killed: 'bg-gray-500/20 text-gray-300',
};

interface GoalDetailPanelProps {
  goal: PmGoal | null;
  goals: PmGoal[];
  tickets: PmTicket[];
  requirements: PmRequirement[];
  requirementLinks: PmGoalRequirementLink[];
  runs: PmGoalRun[];
  launchingAgent: boolean;
  onUpdate: (id: string, updates: Partial<PmGoal>) => void;
  onDelete: (id: string) => void;
  onAchieve: (id: string) => void;
  onAddSubGoal: (parentId: string) => void;
  onLaunchAgent: (goal: PmGoal) => void;
  onLinkRequirement: (goalId: string, requirementId: string) => void;
  onUnlinkRequirement: (goalId: string, requirementId: string) => void;
}

const inputCls =
  'w-full rounded-lg bg-white/5 px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:ring-1 focus:ring-primary/30';
const labelCls = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-foreground-muted';

export function GoalDetailPanel({
  goal,
  goals,
  tickets,
  requirements,
  requirementLinks,
  runs,
  launchingAgent,
  onUpdate,
  onDelete,
  onAchieve,
  onAddSubGoal,
  onLaunchAgent,
  onLinkRequirement,
  onUnlinkRequirement,
}: GoalDetailPanelProps) {
  const [reqPickerValue, setReqPickerValue] = useState('');

  const satisfaction = useMemo(
    () =>
      goal ? getGoalSatisfaction(goals, tickets, requirements, requirementLinks, goal.id) : null,
    [goal, goals, tickets, requirements, requirementLinks]
  );

  const goalTickets = useMemo(
    () => (goal ? tickets.filter((t) => t.goalId === goal.id) : []),
    [goal, tickets]
  );

  const goalRuns = useMemo(() => (goal ? getRunsForGoal(runs, goal.id) : []), [goal, runs]);

  const linkedRequirements = useMemo(() => {
    if (!goal) return [];
    const ids = new Set(
      requirementLinks.filter((l) => l.goalId === goal.id).map((l) => l.requirementId)
    );
    return requirements.filter((r) => ids.has(r.id));
  }, [goal, requirements, requirementLinks]);

  const linkableRequirements = useMemo(() => {
    const linked = new Set(linkedRequirements.map((r) => r.id));
    return requirements.filter((r) => !linked.has(r.id));
  }, [requirements, linkedRequirements]);

  if (!goal) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-xs text-foreground-muted">Select a goal to inspect and steer it.</p>
      </div>
    );
  }

  const style = GOAL_STATUS_STYLES[goal.status] ?? GOAL_STATUS_STYLES.draft;

  return (
    <div data-testid="goal-detail" className="flex-1 space-y-4 overflow-y-auto p-4">
      {/* Name + status */}
      <div>
        <input
          data-testid="goal-detail-name"
          value={goal.name}
          onChange={(e) => onUpdate(goal.id, { name: e.target.value })}
          className="w-full bg-transparent text-sm font-bold text-foreground outline-none focus:ring-1 focus:ring-primary/30 rounded-lg px-1 -mx-1"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <select
            data-testid="goal-detail-status"
            value={goal.status}
            onChange={(e) => onUpdate(goal.id, { status: e.target.value as PmGoal['status'] })}
            className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground outline-none"
          >
            {Object.entries(GOAL_STATUS_STYLES).map(([value, s]) => (
              <option key={value} value={value} className="bg-background-dark">
                {s.label}
              </option>
            ))}
          </select>
          <select
            data-testid="goal-detail-priority"
            value={goal.priority}
            onChange={(e) => onUpdate(goal.id, { priority: e.target.value as PmGoal['priority'] })}
            className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground outline-none"
          >
            {['low', 'normal', 'high', 'critical'].map((p) => (
              <option key={p} value={p} className="bg-background-dark">
                {p}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[9px] text-foreground-muted" title="Provenance">
            by {goal.createdBy}
          </span>
        </div>
      </div>

      {/* Satisfaction check */}
      {satisfaction && (
        <div
          data-testid="goal-satisfaction"
          className={`rounded-xl border p-3 ${
            satisfaction.satisfied
              ? 'border-green-500/30 bg-green-500/10'
              : 'border-white/10 bg-white/5'
          }`}
        >
          {satisfaction.satisfied ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-green-300">
                All checks green. Ready to achieve.
              </p>
              {goal.status !== 'achieved' && (
                <button
                  data-testid="goal-achieve-btn"
                  onClick={() => onAchieve(goal.id)}
                  className="rounded-lg bg-green-500/20 border border-green-500/30 px-3 py-1 text-[10px] font-bold text-green-300 hover:bg-green-500/30 transition-colors"
                >
                  Mark achieved
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-muted">
                Blockers ({satisfaction.blockers.length})
              </p>
              <ul className="space-y-1">
                {satisfaction.blockers.slice(0, 6).map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                    <span className="material-symbols-outlined mt-px text-[12px] text-amber-400">
                      block
                    </span>
                    {b}
                  </li>
                ))}
                {satisfaction.blockers.length > 6 && (
                  <li className="text-[10px] text-foreground-muted">
                    +{satisfaction.blockers.length - 6} more
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="goal-launch-agent-btn"
          onClick={() => onLaunchAgent(goal)}
          disabled={launchingAgent}
          className="flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-medium text-primary-light hover:bg-primary/25 transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-sm">rocket_launch</span>
          {launchingAgent ? 'Launching…' : 'Launch agent'}
        </button>
        <button
          data-testid="goal-add-subgoal-btn"
          onClick={() => onAddSubGoal(goal.id)}
          className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-[11px] text-foreground hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">account_tree</span>
          Add sub-goal
        </button>
        <button
          data-testid="goal-delete-btn"
          onClick={() => onDelete(goal.id)}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-red-400/70 hover:bg-red-500/10 hover:text-red-300 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          data-testid="goal-detail-description"
          value={goal.description}
          onChange={(e) => onUpdate(goal.id, { description: e.target.value })}
          rows={3}
          placeholder="What world state does this goal describe?"
          className={inputCls}
        />
      </div>

      {/* Success criteria */}
      <div>
        <label className={labelCls}>Success criteria</label>
        <textarea
          data-testid="goal-detail-criteria"
          value={goal.successCriteria}
          onChange={(e) => onUpdate(goal.id, { successCriteria: e.target.value })}
          rows={3}
          placeholder="- Machine-checkable checklist that defines 'achieved'"
          className={inputCls}
        />
      </div>

      {/* Goal prompt */}
      <div>
        <label className={labelCls}>Goal prompt (agent launch artifact)</label>
        <textarea
          data-testid="goal-detail-prompt"
          value={goal.goalPrompt}
          onChange={(e) => onUpdate(goal.id, { goalPrompt: e.target.value })}
          rows={3}
          placeholder="Optional: exact prompt used when launching agents. Leave empty to auto-generate from name, description and criteria."
          className={inputCls}
        />
      </div>

      {/* Linked tickets */}
      <div>
        <label className={labelCls}>Tickets ({goalTickets.length})</label>
        {goalTickets.length === 0 ? (
          <p className="text-[10px] text-foreground-muted/70">
            No tickets attached. Link tickets to this goal in Project Management or via MCP.
          </p>
        ) : (
          <ul className="space-y-1">
            {goalTickets.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-foreground/90"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    t.status === 'done'
                      ? 'bg-green-400'
                      : t.status === 'in_progress'
                        ? 'bg-amber-400'
                        : 'bg-gray-400'
                  }`}
                />
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-[9px] text-foreground-muted">{t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Linked requirements */}
      <div>
        <label className={labelCls}>Requirements (invariants)</label>
        {linkedRequirements.length === 0 && goalTickets.length > 0 && (
          <p
            data-testid="goal-no-requirement-hint"
            className="mb-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300/90"
          >
            <span className="material-symbols-outlined mt-px text-[12px]">info</span>
            No requirement linked: this goal completes purely on agents exiting cleanly. Link a
            requirement to add a verified acceptance gate.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {linkedRequirements.map((r) => (
            <span
              key={r.id}
              data-testid={`goal-req-chip-${r.id}`}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                r.status === 'verified'
                  ? 'bg-green-500/15 text-green-300'
                  : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {r.reqId}
              <button
                data-testid={`goal-req-unlink-${r.id}`}
                onClick={() => onUnlinkRequirement(goal.id, r.id)}
                className="material-symbols-outlined text-[10px] opacity-60 hover:opacity-100"
                title="Unlink"
              >
                close
              </button>
            </span>
          ))}
        </div>
        {linkableRequirements.length > 0 && (
          <select
            data-testid="goal-req-picker"
            value={reqPickerValue}
            onChange={(e) => {
              if (e.target.value) {
                onLinkRequirement(goal.id, e.target.value);
                setReqPickerValue('');
              }
            }}
            className="mt-1.5 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground-muted outline-none"
          >
            <option value="" className="bg-background-dark">
              + Link requirement…
            </option>
            {linkableRequirements.map((r) => (
              <option key={r.id} value={r.id} className="bg-background-dark">
                {r.reqId} · {r.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Runs */}
      <div>
        <label className={labelCls}>Agent runs ({goalRuns.length})</label>
        {goalRuns.length === 0 ? (
          <p className="text-[10px] text-foreground-muted/70">
            No agents launched for this goal yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {goalRuns.map((run) => (
              <li key={run.id} className="rounded-lg bg-white/5 px-2.5 py-2">
                <div className="flex items-center gap-2 text-[10px]">
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-bold ${RUN_OUTCOME_STYLES[run.outcome] ?? RUN_OUTCOME_STYLES.running}`}
                  >
                    {run.outcome}
                  </span>
                  <span className="text-foreground-muted">
                    {run.model || 'model?'} · {run.source}
                  </span>
                  <span className="ml-auto tabular-nums text-foreground-muted/70">
                    {run.startedAt}
                  </span>
                </div>
                {run.summary && (
                  <p className="mt-1 text-[10px] text-foreground/80">{run.summary}</p>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer text-[9px] text-foreground-muted hover:text-foreground">
                    Show prompt
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[9px] leading-relaxed text-foreground/70">
                    {run.prompt}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
