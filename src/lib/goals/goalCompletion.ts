import type { GoalWorkMode, ResolvedGoalWorkMode } from './workMode';

/**
 * The completion transition: the one place that decides whether a goal may
 * become `achieved`, whether it is worked by tickets or by stations.
 *
 * Every path that achieves a goal or says it is ready asks here: the detail
 * panel's "Mark achieved" and workflow stepper (`getGoalCompletion`), the
 * conductor's auto-achieve (`conductorTick`) and MCP `evaluate_goal`
 * (`evaluateGoal`). The contract `verification/contracts/goal-satisfaction-v1.json`
 * pins UI and MCP to the same answer.
 *
 * Sub-goal 03's review gate plugs in here: a goal that requires review will
 * add its "no approved review yet" blocker in this function, and with that on
 * every path at once. Until then a goal without review behaves exactly as its
 * satisfaction says, plus one stations-mode rule below.
 */
export interface GoalCompletionInput {
  /** The machine check of tickets, requirements, stations and sub-goals. */
  satisfaction: { satisfied: boolean; blockers: string[] };
  workMode: ResolvedGoalWorkMode;
  /** Whether the goal or any descendant has a station. */
  hasStations: boolean;
}

export interface GoalCompletion {
  achievable: boolean;
  mode: GoalWorkMode;
  /** Why it is not achievable yet. Empty when it is. */
  blockers: string[];
}

export const STATIONS_MODE_WITHOUT_STATIONS =
  'Stations mode: this goal has no stations yet. Plan its stations before it can be achieved.';

export function decideGoalCompletion(input: GoalCompletionInput): GoalCompletion {
  const blockers = [...input.satisfaction.blockers];
  // A goal set to stations mode is done when its stations are; with none there
  // is nothing that says it is done, however green the rest looks.
  if (input.workMode.mode === 'stations' && !input.hasStations) {
    blockers.push(STATIONS_MODE_WITHOUT_STATIONS);
  }
  return { achievable: blockers.length === 0, mode: input.workMode.mode, blockers };
}
