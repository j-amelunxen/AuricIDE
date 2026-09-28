import { isClosedGoalStatus } from '@/lib/pm/enums';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { getGoalDescendants } from '../goals/goalTreeHelpers';

export interface HumanWaitBlockers {
  /** The run's blockers, open human stations first and phrased as asks. */
  blockers: string[];
  /** Nothing but people holds the goal: every other blocker follows from them. */
  onlyHuman: boolean;
}

/**
 * Blockers that name concrete open work. Sub-goal, bundle and dependency
 * lines are consequences: a sub-goal is open because something in it is.
 */
const WORK_BLOCKER = /^(Station |Ticket |Requirement |This goal has no attached)/;

/**
 * Rephrases the blockers an unattended run ends with, so what waits for a
 * person reads as an ask and comes first. The satisfaction wording itself is
 * left alone: `ownGoalBlockers` has an SQL twin in the MCP server, and this
 * is only how the conductor reports it.
 */
export function withHumanWaitsFirst(
  blockers: string[],
  goals: PmGoal[],
  stations: PmGoalStation[],
  goalId: string
): HumanWaitBlockers {
  const openGoals = new Set(
    [goals.find((g) => g.id === goalId), ...getGoalDescendants(goals, goalId)]
      .filter((g): g is PmGoal => !!g && !isClosedGoalStatus(g.status))
      .map((g) => g.id)
  );
  const waiting = stations.filter(
    (s) => s.kind === 'human' && s.status !== 'done' && openGoals.has(s.goalId)
  );
  // The exact line ownGoalBlockers wrote for each of these stations.
  const replaced = new Set(waiting.map((s) => `Station "${s.name}" is ${s.status}`));
  const rest = blockers.filter((b) => !replaced.has(b));
  return {
    blockers: [...waiting.map((s) => `Waiting for you: station "${s.name}"`), ...rest],
    onlyHuman: waiting.length > 0 && !rest.some((b) => WORK_BLOCKER.test(b)),
  };
}
