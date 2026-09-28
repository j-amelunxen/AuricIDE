import { isLaunchRequest } from '@/lib/notifications/launchRequest';
import type { Notification } from '@/lib/notifications/types';
import { isClosedGoalStatus } from '@/lib/pm/enums';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { PmGoal, PmGoalDependency, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { getGoalChildren, getGoalDescendants } from '../goals/goalTreeHelpers';
import { isGoalBlockedByDependency } from '../goals/goalDependencyAdapters';
import { getGoalWorkMode } from '../goals/goalSatisfaction';
import { MAX_TICKET_ATTEMPTS } from './conductorTypes';

/**
 * How a conductor run works a goal in stations mode: not by spawning one
 * agent per ticket, but by spawning one goal agent per goal whose own line
 * still has agent work (`conductorGoalAgents.ts`). Starting the run on a goal
 * is the approval for its tree, so the agent starts headless right away,
 * like a ticket agent, rather than waiting on a launch request.
 *
 * A launch request someone else wrote for the goal (MCP
 * `request_agent_launch`) still counts as work in flight: the conductor does
 * not start a second agent beside the one that request will start.
 *
 * Only a goal-scoped run does this. An unscoped run ("all tickets") stays on
 * tickets, so pressing Start without a goal never fans agents out across the
 * whole project.
 */

/** Rows that never reached the database carry this id (notificationsSlice). */
const LOCAL_ONLY_ID = 0;

export interface StationGoalWork {
  /** Every open stations goal in scope: a run can at least check whether it is achieved. */
  inScope: string[];
  /** Goals the run may ask an agent for now, in tree order. */
  launchable: PmGoal[];
  /** Goals with a request, an agent or a pending judge verdict in flight. */
  inFlight: string[];
  /** Goals with open agent work whose attempts are used up. */
  exhausted: string[];
  /** Goals held by a dependency edge (`isGoalBlockedByDependency`) — not their turn yet. */
  blocked: string[];
}

export interface StationGoalInput {
  goals: PmGoal[];
  tickets: PmTicket[];
  stations: PmGoalStation[];
  goalId: string | null;
  notifications: Notification[];
  agents: AgentInfo[];
  projectPath: string | null;
  /** goalId -> goal agents this run already spawned for it. */
  attempts: Record<string, number>;
  /** A judge is configured, so a fresh claim will still get its verdict. */
  judgeConfigured: boolean;
  /** Edges gating goal launchability. Absent reads as "no dependencies". */
  goalDependencies?: PmGoalDependency[];
}

/** An open station an agent may work: not human, not a gate, not done. */
function isAgentWork(station: PmGoalStation): boolean {
  return station.kind === 'normal' && station.status !== 'done';
}

/** A claim no judge has looked at yet (the judge stamps `lastCheckedAt`). */
function awaitsJudge(station: PmGoalStation): boolean {
  return (
    station.status === 'done' && station.evidenceKind === 'claim' && station.lastCheckedAt === null
  );
}

/** Goals in scope that are worked by their own stations. */
function stationGoalsInScope(input: StationGoalInput): PmGoal[] {
  const { goals, tickets, stations, goalId } = input;
  if (!goalId) return [];
  const root = goals.find((g) => g.id === goalId);
  const scope = [...(root ? [root] : []), ...getGoalDescendants(goals, goalId)];
  return scope.filter(
    (goal) =>
      !isClosedGoalStatus(goal.status) &&
      stations.some((s) => s.goalId === goal.id) &&
      getGoalWorkMode(goals, tickets, stations, goal.id).mode === 'stations'
  );
}

function hasOpenRequest(input: StationGoalInput, goalId: string): boolean {
  return input.notifications.some(
    (n) =>
      n.id !== LOCAL_ONLY_ID &&
      isLaunchRequest(n) &&
      n.refId === goalId &&
      n.answeredAt === null &&
      n.projectPath === input.projectPath
  );
}

function hasLiveAgent(input: StationGoalInput, goalId: string): boolean {
  return input.agents.some(
    (a) => a.spawnedByGoalId === goalId && (a.status === 'running' || a.status === 'queued')
  );
}

export function getStationGoalWork(input: StationGoalInput): StationGoalWork {
  const work: StationGoalWork = {
    inScope: [],
    launchable: [],
    inFlight: [],
    exhausted: [],
    blocked: [],
  };
  const goalDependencies = input.goalDependencies ?? [];
  for (const goal of stationGoalsInScope(input)) {
    work.inScope.push(goal.id);
    // Held up by a dependency edge: not the agent's turn yet, whatever state
    // its own stations are in.
    if (isGoalBlockedByDependency(input.goals, goalDependencies, goal.id)) {
      work.blocked.push(goal.id);
      continue;
    }
    const own = input.stations.filter((s) => s.goalId === goal.id);
    const judgePending = input.judgeConfigured && own.some(awaitsJudge);
    // A goal in review waits for its verdict; a second agent would work what is being judged.
    const reviewPending = goal.status === 'in_review';
    if (
      hasOpenRequest(input, goal.id) ||
      hasLiveAgent(input, goal.id) ||
      judgePending ||
      reviewPending
    ) {
      work.inFlight.push(goal.id);
      continue;
    }
    if (!own.some(isAgentWork)) continue;
    if ((input.attempts[goal.id] ?? 0) >= MAX_TICKET_ATTEMPTS) {
      work.exhausted.push(goal.id);
    } else {
      work.launchable.push(goal);
    }
  }
  return work;
}

/**
 * The tickets a run may hand to ticket agents: none that belong to a goal in
 * stations mode. Such a goal is worked by its goal agent; its tickets (an
 * explicit `stations` setting wins over existing tickets) are not a second
 * way in.
 */
export function ticketsWorkedAsTickets(
  tickets: PmTicket[],
  goals: PmGoal[],
  stations: PmGoalStation[]
): PmTicket[] {
  const modeOf = new Map<string, boolean>();
  const isStationsGoal = (goalId: string): boolean => {
    let known = modeOf.get(goalId);
    if (known === undefined) {
      known = getGoalWorkMode(goals, tickets, stations, goalId).mode === 'stations';
      modeOf.set(goalId, known);
    }
    return known;
  };
  return tickets.filter((t) => !t.goalId || !isStationsGoal(t.goalId));
}

export interface PlanningWork {
  /** Goals with no work attached that the run may spawn a planning agent for now. */
  launchable: PmGoal[];
  /** Goals whose planning agent is still running. */
  inFlight: string[];
  /** Goals still empty after every planning attempt. */
  exhausted: string[];
}

/**
 * A goal in scope with nothing to work: no stations, no tickets and no
 * sub-goals. Without a plan it would only ever end the run blocked, so the
 * conductor spawns an agent that lays one out. A goal held by a dependency
 * waits for its turn like any other; its plan could still change by then.
 */
function hasNoWork(input: StationGoalInput, goal: PmGoal): boolean {
  return (
    !isClosedGoalStatus(goal.status) &&
    !input.stations.some((s) => s.goalId === goal.id) &&
    !input.tickets.some((t) => t.goalId === goal.id) &&
    getGoalChildren(input.goals, goal.id).length === 0
  );
}

export function getPlanningWork(
  input: StationGoalInput & { planAttempts: Record<string, number> }
): PlanningWork {
  const work: PlanningWork = { launchable: [], inFlight: [], exhausted: [] };
  const { goals, goalId } = input;
  if (!goalId) return work;
  const root = goals.find((g) => g.id === goalId);
  const scope = [...(root ? [root] : []), ...getGoalDescendants(goals, goalId)];
  for (const goal of scope) {
    if (!hasNoWork(input, goal)) continue;
    if (isGoalBlockedByDependency(goals, input.goalDependencies ?? [], goal.id)) continue;
    if (hasLiveAgent(input, goal.id)) {
      work.inFlight.push(goal.id);
    } else if ((input.planAttempts[goal.id] ?? 0) >= MAX_TICKET_ATTEMPTS) {
      work.exhausted.push(goal.id);
    } else {
      work.launchable.push(goal);
    }
  }
  return work;
}
