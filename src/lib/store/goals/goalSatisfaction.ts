import type { PmGoal, PmGoalRequirementLink, PmGoalRun, PmGoalStation } from '../../tauri/goals';
import type { PmTicket } from '../../tauri/pm';
import type { PmRequirement } from '../../tauri/requirements';
import { isVerifiedEvidence } from '../../pm/enums';
import { getGoalChildren, getGoalDescendants } from './goalTreeHelpers';
import { resolveGoalWorkMode, type ResolvedGoalWorkMode } from '../../goals/workMode';
import { decideGoalCompletion, type GoalCompletion } from '../../goals/goalCompletion';

export interface GoalProgress {
  totalTickets: number;
  doneTickets: number;
}

/** Ticket progress across the goal itself plus all of its descendants. */
export function getGoalProgress(
  goals: PmGoal[],
  tickets: PmTicket[],
  goalId: string
): GoalProgress {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  const scoped = tickets.filter((t) => !!t.goalId && ids.has(t.goalId) && t.status !== 'discarded');
  return {
    totalTickets: scoped.length,
    doneTickets: scoped.filter((t) => t.status === 'done').length,
  };
}

/**
 * Which mode the goal is worked in, resolved from its setting and from what
 * its subtree has attached. Discarded tickets are off the board and do not
 * count; the MCP twin (`evaluateGoal`) reads the same shape.
 */
export function getGoalWorkMode(
  goals: PmGoal[],
  tickets: PmTicket[],
  stations: PmGoalStation[],
  goalId: string
): ResolvedGoalWorkMode {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  const goal = goals.find((g) => g.id === goalId);
  return resolveGoalWorkMode(goal?.workMode, {
    hasTickets: tickets.some((t) => !!t.goalId && ids.has(t.goalId) && t.status !== 'discarded'),
    hasStations: stations.some((s) => ids.has(s.goalId)),
  });
}

export interface GoalSatisfaction {
  satisfied: boolean;
  /** Human-readable reasons the goal is not yet satisfied. Empty when satisfied. */
  blockers: string[];
}

/**
 * A goal is satisfied when every ticket attached to it (and its subtree) is
 * done, every linked requirement is verified, every station of its line is
 * done, and every direct child goal is achieved. This is the
 * machine-checkable core of "goal = desired world state".
 *
 * The `stations` parameter is REQUIRED on purpose: an open human station
 * ("call the customer") that satisfaction cannot see would let the conductor
 * auto-achieve a goal right past it. A silent default would compile at
 * exactly the call site someone forgot. This function has an SQL twin in
 * src/mcp/tools/goals.ts (evaluateGoal) — change both together.
 */
export function getGoalSatisfaction(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
  stations: PmGoalStation[],
  goalId: string
): GoalSatisfaction {
  const blockers: string[] = [];
  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);

  const scopedTickets = tickets.filter((t) => !!t.goalId && subtreeIds.has(t.goalId));
  for (const ticket of scopedTickets) {
    // Cancelled work is off the board; it is not a remaining obligation.
    if (ticket.status === 'discarded') continue;
    if (ticket.status !== 'done') {
      blockers.push(`Ticket "${ticket.name}" is ${ticket.status}`);
    }
  }

  const linkedReqIds = new Set(
    links.filter((l) => l.goalId === goalId).map((l) => l.requirementId)
  );
  for (const req of requirements) {
    if (linkedReqIds.has(req.id) && req.status !== 'verified') {
      blockers.push(`Requirement ${req.reqId} is ${req.status}, not verified`);
    }
  }

  const scopedStations = stations.filter((s) => subtreeIds.has(s.goalId));
  for (const station of scopedStations) {
    if (station.status !== 'done') {
      blockers.push(`Station "${station.name}" is ${station.status}`);
    } else if (!isVerifiedEvidence(station.evidenceKind)) {
      // Done, but only claimed — the judge (or a person) has to verify it
      // before it counts. A bare claim blocks exactly like a pending station.
      blockers.push(`Station "${station.name}": unverified claim`);
    }
  }

  const children = getGoalChildren(goals, goalId);
  for (const child of children) {
    if (child.status !== 'achieved') {
      blockers.push(`Sub-goal "${child.name}" is ${child.status}, not achieved`);
    }
  }

  // A goal with nothing attached is vacuously "true" but not meaningfully
  // achieved — refuse to auto-satisfy it.
  if (
    scopedTickets.length === 0 &&
    linkedReqIds.size === 0 &&
    children.length === 0 &&
    scopedStations.length === 0
  ) {
    blockers.push(
      'This goal has no attached tickets, linked requirements, child goals, or goal-line stations. Add work before running the conductor.'
    );
  }

  return { satisfied: blockers.length === 0, blockers };
}

/**
 * Whether the goal may become achieved, through the one completion transition
 * (`decideGoalCompletion`). The MCP twin is `evaluateGoal(...).completion`.
 */
export function getGoalCompletion(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
  stations: PmGoalStation[],
  goalId: string
): GoalCompletion {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  return decideGoalCompletion({
    satisfaction: getGoalSatisfaction(goals, tickets, requirements, links, stations, goalId),
    workMode: getGoalWorkMode(goals, tickets, stations, goalId),
    hasStations: stations.some((s) => ids.has(s.goalId)),
  });
}

export interface GoalStationProgress {
  /** Stations done with verified evidence (a bare claim does not count). */
  done: number;
  total: number;
  /** True when the stations sit on sub-goals rather than on the goal itself. */
  onSubGoals: boolean;
}

/** Station progress across the goal and its subtree, counted like satisfaction counts it. */
export function getGoalStationProgress(
  goals: PmGoal[],
  stations: PmGoalStation[],
  goalId: string
): GoalStationProgress {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  const scoped = stations.filter((s) => ids.has(s.goalId));
  return {
    done: scoped.filter((s) => s.status === 'done' && isVerifiedEvidence(s.evidenceKind)).length,
    total: scoped.length,
    onSubGoals: scoped.length > 0 && !scoped.some((s) => s.goalId === goalId),
  };
}

export interface GoalWorkProgress {
  done: number;
  total: number;
  unit: 'stations' | 'tickets';
}

/**
 * The progress a goal shows, in the unit of its work mode: verified stations
 * for a stations goal, done tickets for a ticket goal. One helper for the goal
 * tree, the orchestration graph and the Line of Goals.
 */
export function getGoalWorkProgress(
  goals: PmGoal[],
  tickets: PmTicket[],
  stations: PmGoalStation[],
  goalId: string
): GoalWorkProgress {
  if (getGoalWorkMode(goals, tickets, stations, goalId).mode === 'stations') {
    const { done, total } = getGoalStationProgress(goals, stations, goalId);
    return { done, total, unit: 'stations' };
  }
  const { doneTickets, totalTickets } = getGoalProgress(goals, tickets, goalId);
  return { done: doneTickets, total: totalTickets, unit: 'tickets' };
}

export type GoalWorkflowStage = 'define' | 'attach' | 'execute' | 'done';

export interface GoalWorkflowStep {
  stage: GoalWorkflowStage;
  /** 1-based position in the define → attach → execute → done loop. */
  index: 1 | 2 | 3 | 4;
  /** The one concrete next action that moves the goal forward. */
  hint: string;
}

/**
 * Where a goal stands in the workflow loop. Drives the onboarding stepper:
 * each stage names exactly one next action instead of explaining everything.
 */
export function getGoalWorkflowStage(
  goals: PmGoal[],
  tickets: PmTicket[],
  requirements: PmRequirement[],
  links: PmGoalRequirementLink[],
  stations: PmGoalStation[],
  goalId: string
): GoalWorkflowStep {
  const goal = goals.find((g) => g.id === goalId);
  const completion = getGoalCompletion(goals, tickets, requirements, links, stations, goalId);
  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);
  const hasTickets = tickets.some((t) => !!t.goalId && subtreeIds.has(t.goalId));
  // Ticket mode needs tickets before it counts as done; stations mode is done
  // when its stations are, with no ticket anywhere.
  const readyToAchieve = completion.achievable && (completion.mode === 'stations' || hasTickets);

  if (goal?.status === 'achieved' || readyToAchieve) {
    return {
      stage: 'done',
      index: 4,
      hint:
        goal?.status === 'achieved'
          ? 'Goal achieved.'
          : 'Checks green: mark achieved or run conductor.',
    };
  }

  if (!goal?.successCriteria.trim()) {
    return {
      stage: 'define',
      index: 1,
      hint: 'Add success criteria.',
    };
  }

  const hasStations = stations.some((s) => subtreeIds.has(s.goalId));

  if (completion.mode === 'stations') {
    if (!hasStations) {
      return { stage: 'attach', index: 2, hint: 'Plan the stations of this goal.' };
    }
    const progress = getGoalStationProgress(goals, stations, goalId);
    const where = progress.onSubGoals ? ' across its sub-goals' : '';
    return {
      stage: 'execute',
      index: 3,
      hint: `${progress.done} of ${progress.total} stations verified${where}. Work the stations with an agent or start the conductor.`,
    };
  }

  if (!hasTickets) {
    return {
      stage: 'attach',
      index: 2,
      hint: hasStations
        ? 'The plan is saved. Create tickets for its executable work.'
        : 'Plan the checkpoints, then create executable tickets.',
    };
  }

  return {
    stage: 'execute',
    index: 3,
    hint: 'Start the conductor to work open tickets.',
  };
}

export function getRunsForGoal(runs: PmGoalRun[], goalId: string): PmGoalRun[] {
  return runs
    .filter((r) => r.goalId === goalId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
