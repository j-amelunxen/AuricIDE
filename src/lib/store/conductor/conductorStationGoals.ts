import { isLaunchRequest } from '@/lib/notifications/launchRequest';
import type { Notification } from '@/lib/notifications/types';
import { isClosedGoalStatus } from '@/lib/pm/enums';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { getGoalDescendants } from '../goals/goalTreeHelpers';
import { getGoalWorkMode } from '../goals/goalSatisfaction';
import { MAX_TICKET_ATTEMPTS } from './conductorTypes';

/**
 * How a conductor run works a goal in stations mode: not by spawning one
 * agent per ticket, but by asking for one goal agent per goal whose own line
 * still has agent work. The ask is a launch request, the same row MCP
 * `request_agent_launch` writes, so the start goes through the one launch path
 * (click or launch grant, its limit and budget, the native directory check)
 * and never around it.
 *
 * Only a goal-scoped run does this. An unscoped run ("all tickets") stays on
 * tickets, so pressing Start without a goal never fans out requests across the
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
}

export interface StationGoalInput {
  goals: PmGoal[];
  tickets: PmTicket[];
  stations: PmGoalStation[];
  goalId: string | null;
  notifications: Notification[];
  agents: AgentInfo[];
  projectPath: string | null;
  /** goalId -> launch requests this run already wrote for it. */
  attempts: Record<string, number>;
  /** A judge is configured, so a fresh claim will still get its verdict. */
  judgeConfigured: boolean;
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
  const work: StationGoalWork = { inScope: [], launchable: [], inFlight: [], exhausted: [] };
  for (const goal of stationGoalsInScope(input)) {
    work.inScope.push(goal.id);
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
