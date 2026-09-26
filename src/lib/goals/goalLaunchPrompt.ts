import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { GoalWorkMode } from './workMode';

const TICKET_AGREEMENT = (goal: PmGoal): string =>
  'Work mode: tickets. ' +
  `Work autonomously toward this goal. Its goalId is "${goal.id}". Use this exact ` +
  'value with the auric-pm MCP tools, do not look it up by name. If those tools are ' +
  'available, first call list_epics and reuse an appropriate epic; if none exists, call ' +
  `create_epic with the name "${goal.name}". Pass the resulting epicId to every ` +
  `create_ticket (goalId: "${goal.id}") to create executable tickets in the saved order. ` +
  'Human checkpoints must also become tickets with needsHumanSupervision: true. After each ' +
  "ticket is created, call update_station with that checkpoint's stationId and the returned " +
  "ticketId to link them. Preserve the saved line's intent and order. Use " +
  `evaluate_goal (id: "${goal.id}") ` +
  'to check progress, and record findings as context items or via write_finding. Do NOT ' +
  'call record_goal_run: this run is already recorded. Exit when the success ' +
  'criteria are met or you are blocked.';

const STATION_AGREEMENT = (goal: PmGoal, hasOwnLine: boolean): string =>
  'Work mode: stations. ' +
  `Work autonomously toward this goal. Its goalId is "${goal.id}". Use this exact ` +
  'value with the auric-pm MCP tools, do not look it up by name. Do not create an epic or ' +
  'tickets for this goal: its stations are the plan. ' +
  (hasOwnLine
    ? 'Work the saved line directly, in its order. '
    : 'Its stations live on its sub-goals: call get_goal_tree and list_stations for each ' +
      'sub-goal, and work them in order. ') +
  'For each station, do the work, then call mark_station_done with its stationId and an ' +
  'evidenceNote that says what you did and where the evidence lives (file path, command, ' +
  'commit). A done station counts once its evidence is verified. Leave human stations to a ' +
  'person: never mark them done yourself, say what the person has to check. ' +
  `Use list_stations (goalId: "${goal.id}") to see where the line stands and ` +
  `evaluate_goal (id: "${goal.id}") to check progress, and record findings via ` +
  'write_finding. Do NOT call record_goal_run: this run is already recorded. Exit when ' +
  'every station you can do is done, or you are blocked.';

/**
 * Builds the launch prompt for a goal: explicit goalPrompt wins, else generated.
 * The working agreement follows the goal's work mode: in ticket mode the agent
 * turns the line into an epic and tickets, in stations mode it works the
 * stations itself and marks each one done with evidence.
 */
export function buildGoalLaunchPrompt(
  goal: PmGoal,
  stations: PmGoalStation[] = [],
  mode: GoalWorkMode = 'tickets'
): string {
  const parts = [`# Goal: ${goal.name} (goalId: ${goal.id})`];
  if (goal.goalPrompt.trim()) {
    parts.push(`## Goal instructions\n${goal.goalPrompt}`);
  } else {
    if (goal.description) parts.push(goal.description);
    if (goal.successCriteria) parts.push(`## Success criteria\n${goal.successCriteria}`);
  }
  const savedLine = stations
    .filter((station) => station.goalId === goal.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (savedLine.length > 0) {
    parts.push(
      `## Saved line\n${savedLine
        .map(
          (station, index) =>
            `${index + 1}. ${station.name} (stationId: ${station.id}${station.kind === 'human' ? ', human' : ''})`
        )
        .join('\n')}`
    );
  }
  parts.push(
    `## Working agreement\n${
      mode === 'stations' ? STATION_AGREEMENT(goal, savedLine.length > 0) : TICKET_AGREEMENT(goal)
    }`
  );
  // Launching an agent for a goal invokes the /goal command first.
  return `/goal\n\n${parts.join('\n\n')}`;
}
