'use client';

import { useMemo } from 'react';
import type { PmGoal, PmGoalRequirementLink, PmGoalRun } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import {
  getGoalBlockers,
  getGoalDescendants,
  getGoalCompletion,
  getGoalWorkMode,
  getGoalWorkflowStage,
  getRunsForGoal,
} from '@/lib/store/goalsSlice';
import { GOAL_WORK_MODE_SETTINGS, type GoalWorkModeSetting } from '@/lib/goals/workMode';
import { summarizeBlockers } from '@/lib/orchestration/blockerLabel';
import { useStore } from '@/lib/store';
import { GOAL_STATUS_STYLES } from './GoalTree';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { GoalWorkflowStepper } from './detail/GoalWorkflowStepper';
import { GoalSatisfactionCard } from './detail/GoalSatisfactionCard';
import { GoalTicketsSection } from './detail/GoalTicketsSection';
import { GoalRequirementsSection } from './detail/GoalRequirementsSection';
import { GoalRunsSection } from './detail/GoalRunsSection';
import { GoalTiming } from './detail/GoalTiming';
import { GoalCost } from './detail/GoalCost';
import { useProjectUsageRows } from '@/app/components/pm/cost/useProjectUsageRows';
import { MissionLaunchGrantSection } from './detail/MissionLaunchGrantSection';
import { GoalConflictNotice } from './detail/GoalConflictNotice';
import { MissionOverviewSection } from './detail/MissionOverviewSection';
import { GoalDependenciesSection } from './detail/GoalDependenciesSection';
import { SubGoalPlanGraph } from './SubGoalPlanGraph';
import { resolveMissionDir } from '@/lib/missions/missionPath';
import { LinkifiedTextarea } from '@/app/components/common/LinkifiedTextarea';

export { GoalWorkflowStepper } from './detail/GoalWorkflowStepper';
export { GoalSatisfactionCard } from './detail/GoalSatisfactionCard';
export { GoalTicketsSection } from './detail/GoalTicketsSection';
export { GoalRequirementsSection } from './detail/GoalRequirementsSection';
export { GoalRunsSection } from './detail/GoalRunsSection';

const WORK_MODE_LABELS: Record<GoalWorkModeSetting, string> = {
  auto: 'Auto',
  stations: 'Stations (no tickets)',
  tickets: 'Tickets',
};

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
  onSplitGoal: (goal: PmGoal) => void;
  onLinkRequirement: (goalId: string, requirementId: string) => void;
  onUnlinkRequirement: (goalId: string, requirementId: string) => void;
  onLinkTicket: (goalId: string, ticketId: string) => void;
  onUnlinkTicket: (ticketId: string) => void;
}

const inputCls =
  'w-full rounded-lg bg-white/5 px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:ring-1 focus:ring-primary/30';
const labelCls = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-foreground-muted';

// code-gate: complexity-function-length, complexity-parameter-count - top-level goal detail panel; pre-existing wide callback/data surface from GoalsModal (16 props before this work), already split into detail/* sections — bagging the callbacks would relocate, not remove, the coupling
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
  onSplitGoal,
  onLinkRequirement,
  onUnlinkRequirement,
  onLinkTicket,
  onUnlinkTicket,
}: GoalDetailPanelProps) {
  const stations = useStore((s) => s.goalStationsDraft);
  const rootPath = useStore((s) => s.rootPath);
  const goalDependencies = useStore((s) => s.goalDependenciesDraft);
  const addGoalDependency = useStore((s) => s.addGoalDependency);
  const removeGoalDependency = useStore((s) => s.removeGoalDependency);
  const setGoalBundle = useStore((s) => s.setGoalBundle);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const showToast = useStore((s) => s.showToast);
  // Only a root goal stands for a mission; the stored path is project-relative.
  const missionDir = goal?.parentId === null ? resolveMissionDir(rootPath, goal.missionPath) : null;

  // The card and its "Mark achieved" button follow the completion transition,
  // the same rule as the conductor and MCP evaluate_goal.
  const completion = useMemo(
    () =>
      goal
        ? getGoalCompletion(goals, tickets, requirements, requirementLinks, stations, goal.id)
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

  const workMode = useMemo(
    () => (goal ? getGoalWorkMode(goals, tickets, stations, goal.id) : null),
    [goal, goals, tickets, stations]
  );

  const usageRows = useProjectUsageRows();
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
  // A blocked goal's launch is refused, not silently allowed to start work a
  // dependency has not cleared for yet — see summarizeBlockers for wording.
  const launchBlockedReason = summarizeBlockers(
    goals,
    getGoalBlockers(goals, goalDependencies, goal.id)
  );

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

      <GoalConflictNotice goalId={goal.id} />

      {/* Dependencies: what this goal waits for, and its bundle */}
      <GoalDependenciesSection
        key={goal.id}
        goal={goal}
        goals={goals}
        dependencies={goalDependencies}
        onAddDependency={addGoalDependency}
        onRemoveDependency={removeGoalDependency}
        onSetBundle={setGoalBundle}
        onError={(message) => showToast(message, 'error')}
        labelCls={labelCls}
        inputCls={inputCls}
      />

      {/* Workflow stepper */}
      {workflowStep && <GoalWorkflowStepper workflowStep={workflowStep} />}

      {/* Satisfaction check */}
      {completion && (
        <GoalSatisfactionCard
          goal={goal}
          satisfaction={{ satisfied: completion.achievable, blockers: completion.blockers }}
          onAchieve={onAchieve}
        />
      )}

      {/* Mission root: what its shared memory says, read from the files */}
      {missionDir && (
        <MissionOverviewSection key={missionDir} missionPath={missionDir} labelCls={labelCls} />
      )}

      {/* Actions */}
      <div>
        {workMode && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label htmlFor="goal-work-mode" className="text-[10px] text-foreground-muted">
              Work mode
            </label>
            <select
              id="goal-work-mode"
              data-testid="goal-work-mode"
              value={workMode.setting}
              onChange={(e) =>
                onUpdate(goal.id, { workMode: e.target.value as GoalWorkModeSetting })
              }
              className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground outline-none"
            >
              {GOAL_WORK_MODE_SETTINGS.map((setting) => (
                <option key={setting} value={setting} className="bg-background-dark">
                  {WORK_MODE_LABELS[setting]}
                </option>
              ))}
            </select>
            <span data-testid="goal-work-mode-reason" className="text-[9px] text-foreground-muted">
              {workMode.reason}
            </span>
          </div>
        )}
        {workMode?.mode === 'tickets' && !subtreeHasTickets && (
          <p className="mb-2 text-[10px] text-foreground-muted">
            Conductor works through tickets. Create tickets before launching an agent.
          </p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <div className="max-w-52">
            <span
              data-testid="goal-launch-agent-disabled-explanation"
              tabIndex={launchBlockedReason ? 0 : undefined}
              aria-describedby={launchBlockedReason ? 'goal-launch-disabled-reason' : undefined}
              className="inline-block"
            >
              <button
                data-testid="goal-launch-agent-btn"
                aria-describedby="goal-direct-agent-guidance"
                disabled={!!launchBlockedReason}
                onClick={() => onLaunchAgent(goal)}
                className="flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-medium text-primary-light hover:bg-primary/25 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AuricIcon name="rocket_launch" className="text-sm" />
                {workMode?.mode === 'stations'
                  ? 'Work stations with agent'
                  : subtreeHasTickets
                    ? 'Plan work with agent'
                    : 'Create tickets with agent'}
              </button>
            </span>
            {launchBlockedReason && (
              <span id="goal-launch-disabled-reason" className="sr-only">
                Waits for {launchBlockedReason}.
              </span>
            )}
            <p
              id="goal-direct-agent-guidance"
              data-testid="goal-direct-agent-guidance"
              className="mt-1 text-[9px] leading-snug text-foreground-muted"
            >
              {launchBlockedReason
                ? `Waits for ${launchBlockedReason}.`
                : workMode?.mode === 'stations'
                  ? 'Works the stations directly and marks each one done with evidence. No tickets.'
                  : 'Creates or plans tickets directly on this goal.'}
            </p>
          </div>
          <div className="max-w-56">
            <span
              data-testid="goal-split-agent-disabled-explanation"
              tabIndex={goal.status === 'achieved' ? 0 : undefined}
              aria-describedby={
                goal.status === 'achieved' ? 'goal-split-disabled-reason' : undefined
              }
              className="inline-block"
            >
              <button
                data-testid="goal-split-agent-btn"
                aria-describedby="goal-split-agent-guidance"
                disabled={goal.status === 'achieved'}
                onClick={() => onSplitGoal(goal)}
                className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-[11px] text-foreground hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AuricIcon name="account_tree" className="text-sm" />
                Split into sub-goals with agent
              </button>
            </span>
            {goal.status === 'achieved' && (
              <span id="goal-split-disabled-reason" className="sr-only">
                Achieved goals cannot be split into new sub-goals.
              </span>
            )}
            <p
              id="goal-split-agent-guidance"
              data-testid="goal-split-agent-guidance"
              className="mt-1 text-[9px] leading-snug text-foreground-muted"
            >
              Creates child outcomes, each with its own ticket.
            </p>
          </div>
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

      {/* Sub-goal plan: renders nothing below two children */}
      <SubGoalPlanGraph
        goals={goals}
        dependencies={goalDependencies}
        parentId={goal.id}
        onSelectGoal={setSelectedGoalId}
      />

      {/* Description */}
      <div>
        <label className={labelCls}>Description</label>
        <LinkifiedTextarea
          data-testid="goal-detail-description"
          value={goal.description}
          onChange={(value) => onUpdate(goal.id, { description: value })}
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
      <GoalRunsSection goalRuns={goalRuns} labelCls={labelCls} usageRows={usageRows} />

      <GoalCost goalId={goal.id} goals={goals} tickets={tickets} rows={usageRows} />

      <GoalTiming goalId={goal.id} status={goal.status} />

      {/* Mission root: Jennifer's launch grant */}
      {goal.parentId === null && rootPath && (
        <MissionLaunchGrantSection
          key={goal.id}
          projectPath={rootPath}
          rootGoalId={goal.id}
          rootGoalName={goal.name}
          labelCls={labelCls}
        />
      )}
    </div>
  );
}
