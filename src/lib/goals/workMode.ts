/**
 * How a goal gets worked: through tickets (an epic, one ticket per piece of
 * work, the conductor spawning one agent per ticket) or through its stations
 * (one goal agent works the saved line directly and marks each station done
 * with evidence).
 *
 * The choice is stored per goal as a setting. `auto` is the default and is
 * resolved from the shape of the goal, so the answer is always explainable:
 * a goal with stations and no tickets is worked by stations, everything else
 * stays on tickets, exactly as before this mode existed.
 *
 * Pure on purpose: the UI (`getGoalWorkMode`) and the MCP server
 * (`evaluateGoal`) both resolve through this one function, so they can never
 * disagree about which mode a goal is in.
 */

export const GOAL_WORK_MODE_SETTINGS = ['auto', 'stations', 'tickets'] as const;
export type GoalWorkModeSetting = (typeof GOAL_WORK_MODE_SETTINGS)[number];
export type GoalWorkMode = Exclude<GoalWorkModeSetting, 'auto'>;

/** What the goal (with its whole subtree) has attached right now. */
export interface GoalWorkShape {
  /** Tickets that are not discarded. */
  hasTickets: boolean;
  hasStations: boolean;
}

export interface ResolvedGoalWorkMode {
  mode: GoalWorkMode;
  /** The stored setting as read; unknown values read as `auto`. */
  setting: GoalWorkModeSetting;
  /** One sentence a person can check against the goal. */
  reason: string;
}

function readSetting(value: string | null | undefined): GoalWorkModeSetting {
  return (GOAL_WORK_MODE_SETTINGS as readonly string[]).includes(value ?? '')
    ? (value as GoalWorkModeSetting)
    : 'auto';
}

export function resolveGoalWorkMode(
  stored: string | null | undefined,
  shape: GoalWorkShape
): ResolvedGoalWorkMode {
  const setting = readSetting(stored);
  if (setting !== 'auto') {
    return { mode: setting, setting, reason: `Set on this goal: ${setting}.` };
  }
  if (shape.hasTickets) {
    return { mode: 'tickets', setting, reason: 'Auto: the goal has tickets.' };
  }
  if (shape.hasStations) {
    return { mode: 'stations', setting, reason: 'Auto: the goal has stations and no tickets.' };
  }
  return { mode: 'tickets', setting, reason: 'Auto: no stations planned yet, so tickets.' };
}
