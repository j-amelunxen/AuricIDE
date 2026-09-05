'use client';

import { useMemo } from 'react';
import type { PmGoal, PmGoalRequirementLink, PmGoalRun } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import {
  getGoalDescendants,
  getGoalSatisfaction,
  getGoalWorkflowStage,
  getRunsForGoal,
} from '@/lib/store/goalsSlice';
import { useStore } from '@/lib/store';
import { GOAL_STATUS_STYLES } from './GoalTree';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { GoalWorkflowStepper } from './detail/GoalWorkflowStepper';
import { GoalSatisfactionCard } from './detail/GoalSatisfactionCard';
import { GoalTicketsSection } from './detail/GoalTicketsSection';
import { GoalRequirementsSection } from './detail/GoalRequirementsSection';
import { GoalRunsSection } from './detail/GoalRunsSection';

export { GoalWorkflowStepper } from './detail/GoalWorkflowStepper';
export { GoalSatisfactionCard } from './detail/GoalSatisfactionCard';
export { GoalTicketsSection } from './detail/GoalTicketsSection';
export { GoalRequirementsSection } from './detail/GoalRequirementsSection';
export { GoalRunsSection } from './detail/GoalRunsSection';

export interface GoalDetailPanelProps {
  goal: PmGoal | null;
  goals: PmGoal[];
  tickets: PmTicket[];
  requirements: PmRequirement[];
  requirementLinks: PmGoalRequirementLink[];
  runs: PmGoalRun[];
  onUpdate: (id: string, updates: Partial<PmGoal>) => void;
  onDelete: (id: string) => void;
  onAchieve: (id: string) => void;
  onAddSubGoal: (parentId: string) => void;
  onLaunchAgent: (goal: PmGoal) => void;
  onLinkRequirement: (goalId: string, requirementId: string) => void;
  onUnlinkRequirement: (goalId: string, requirementId: string) => void;
  onLinkTicket: (goalId: string, ticketId: string) => void;
  onUnlinkTicket: (ticketId: string) => void;
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
  onUpdate,
  onDelete,
  onAchieve,
  onAddSubGoal,
  onLaunchAgent,
  onLinkRequirement,
  onUnlinkRequirement,
  onLinkTicket,
  onUnlinkTicket,
}: GoalDetailPanelProps) {
  const stations = useStore((s) => s.goalStationsDraft);

  const satisfaction = useMemo(
    () =>
      goal
        ? getGoalSatisfaction(goals, tickets, requirements, requirementLinks, stations, goal.id)
        : null,
    [goal, goals, tickets, requirements, requirementLinks, stations]
  );

  const workflowStep = useMemo(
    () =>
      goal
        ? getGoalWorkflowStage(goals, tickets, requirements, requirementLinks, stations, goal.id)
        : null,
    [goal, goals, tickets, requirements, requirementLinks, stations]
  );

  const goalTickets = useMemo(
    () => (goal ? tickets.filter((t) => t.goalId === goal.id) : []),
    [goal, tickets]
  );

  const subtreeHasTickets = useMemo(() => {
    if (!goal) return false;
    const ids = new Set([goal.id, ...getGoalDescendants(goals, goal.id).map((item) => item.id)]);
    return tickets.some((ticket) => !!ticket.goalId && ids.has(ticket.goalId));
  }, [goal, goals, tickets]);

  const goalRuns = useMemo(() => (goal ? getRunsForGoal(runs, goal.id) : []), [goal, runs]);

  const validParents = useMemo(() => {
    if (!goal) return [];
    const excluded = new Set([goal.id, ...getGoalDescendants(goals, goal.id).map((g) => g.id)]);
    return goals.filter((candidate) => !excluded.has(candidate.id));
  }, [goal, goals]);

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
          <select
            data-testid="goal-detail-parent"
            aria-label="Parent goal"
            value={goal.parentId ?? ''}
            onChange={(e) => onUpdate(goal.id, { parentId: e.target.value || null })}
            className="max-w-48 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground outline-none"
          >
            <option value="" className="bg-background-dark">
              No parent (top level)
            </option>
            {validParents.map((candidate) => (
              <option key={candidate.id} value={candidate.id} className="bg-background-dark">
                Parent: {candidate.name}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[9px] text-foreground-muted" title="Provenance">
            by {goal.createdBy}
          </span>
        </div>
      </div>

      {/* Workflow stepper */}
      {workflowStep && <GoalWorkflowStepper workflowStep={workflowStep} />}

      {/* Satisfaction check */}
      {satisfaction && (
        <GoalSatisfactionCard goal={goal} satisfaction={satisfaction} onAchieve={onAchieve} />
      )}

      {/* Actions */}
      <div>
        {!subtreeHasTickets && (
          <p className="mb-2 text-[10px] text-foreground-muted">
            Conductor works through tickets. Create tickets before launching an agent.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            data-testid="goal-launch-agent-btn"
            onClick={() => onLaunchAgent(goal)}
            className="flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-medium text-primary-light hover:bg-primary/25 transition-colors"
          >
            <AuricIcon name="rocket_launch" className="text-sm" />
            {subtreeHasTickets ? 'Plan work with agent' : 'Create tickets with agent'}
          </button>
          <button
            data-testid="goal-add-subgoal-btn"
            onClick={() => onAddSubGoal(goal.id)}
            className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-[11px] text-foreground hover:bg-white/10 transition-colors"
          >
            <AuricIcon name="account_tree" className="text-sm" />
            Add sub-goal
          </button>
          <button
            data-testid="goal-delete-btn"
            onClick={() => onDelete(goal.id)}
            className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-red-400/70 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <AuricIcon name="delete" className="text-sm" />
          </button>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          data-testid="goal-detail-description"
          value={goal.description}
          onChange={(e) => onUpdate(goal.id, { description: e.target.value })}
          rows={3}
          placeholder="What should be true when this is done?"
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
          placeholder="- Checkable criteria that define done"
          className={inputCls}
        />
      </div>

      {/* Goal prompt */}
      <div>
        <label className={labelCls}>Goal prompt</label>
        <textarea
          data-testid="goal-detail-prompt"
          value={goal.goalPrompt}
          onChange={(e) => onUpdate(goal.id, { goalPrompt: e.target.value })}
          rows={3}
          placeholder="Optional instructions for the agent"
          className={inputCls}
        />
      </div>

      {/* Linked tickets */}
      <GoalTicketsSection
        goalId={goal.id}
        goalTickets={goalTickets}
        allTickets={tickets}
        onLinkTicket={onLinkTicket}
        onUnlinkTicket={onUnlinkTicket}
        inputCls={inputCls}
        labelCls={labelCls}
      />

      {/* Linked requirements */}
      <GoalRequirementsSection
        goalId={goal.id}
        hasTickets={goalTickets.length > 0}
        requirements={requirements}
        requirementLinks={requirementLinks}
        onLinkRequirement={onLinkRequirement}
        onUnlinkRequirement={onUnlinkRequirement}
        labelCls={labelCls}
      />

      {/* Runs */}
      <GoalRunsSection goalRuns={goalRuns} labelCls={labelCls} />
    </div>
  );
}
