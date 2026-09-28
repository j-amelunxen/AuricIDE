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

const ATTENDED_HUMAN_STATIONS =
  'Human stations belong to a person: never mark them, say what to check. ';

/**
 * Nobody reads an unattended agent's output, so "say what to check" would be
 * said to no one, and stopping at the station would leave the rest undone.
 */
const UNATTENDED_HUMAN_STATIONS =
  'Nobody is reading your output. Human stations belong to a person: never mark them and ' +
  'never wait or ask for one. When you reach one, call request_human_check with its ' +
  'stationId and the concrete steps a person has to check, then continue with the next ' +
  'station. This overrides any instruction above to wait for a person. ';

const STATION_AGREEMENT = (goal: PmGoal, hasOwnLine: boolean, unattended: boolean): string =>
  `Work mode: stations. Use goalId "${goal.id}" exactly with the auric-pm tools. ` +
  'No epic, no tickets: the stations are the plan. ' +
  (hasOwnLine
    ? `list_stations (goalId: "${goal.id}") gives the line in order. `
    : 'Its stations live on its sub-goals: get_goal_tree, then list_stations per sub-goal. ') +
  'Work them in order; after each one, call mark_station_done with its stationId and an ' +
  'evidenceNote saying what you did and where the evidence is. ' +
  (unattended ? UNATTENDED_HUMAN_STATIONS : ATTENDED_HUMAN_STATIONS) +
  `evaluate_goal (id: "${goal.id}") shows progress; record findings via write_finding. ` +
  'Do not call record_goal_run. ' +
  (unattended
    ? 'Stop when only human stations are left open, or you are blocked.'
    : 'Stop when every station you can do is done, or you are blocked.');

export interface GoalLaunchOptions {
  /**
   * The agent runs headless with nobody watching (a conductor run). It gets
   * no /goal command: its stop hook refuses to let the agent end while the
   * goal is unmet, and an open human station keeps it unmet, so the agent
   * would never exit. The conductor checks completion itself afterwards.
   */
  unattended?: boolean;
}

/** The goal lives in the IDE; the prompt points at it rather than copying it. */
const READ_GOAL_FIRST = (goal: PmGoal): string =>
  `## Read the goal first\nCall get_goal (id: "${goal.id}") before anything else and read ` +
  'its description, success criteria and goal prompt. This prompt only points at them.';

/**
 * Builds the launch prompt for a goal. It points at the goal instead of copying
 * it: get_goal gives description and criteria, list_stations the line. Copying
 * them made prompts too long for a /goal condition (4000 characters) and paid
 * for the same text on every turn. An explicit goalPrompt is carried whole,
 * since it is the user's instruction to the agent; the ticket mode still lists
 * the saved line, because its agent links a ticket to each stationId.
 * The working agreement follows the goal's work mode: in ticket mode the agent
 * turns the line into an epic and tickets, in stations mode it works the
 * stations itself and marks each one done with evidence.
 */
export function buildGoalLaunchPrompt(
  goal: PmGoal,
  stations: PmGoalStation[] = [],
  mode: GoalWorkMode = 'tickets',
  { unattended = false }: GoalLaunchOptions = {}
): string {
  const parts = [`# Goal: ${goal.name} (goalId: ${goal.id})`];
  parts.push(READ_GOAL_FIRST(goal));
  if (goal.goalPrompt.trim()) parts.push(`## Goal instructions\n${goal.goalPrompt}`);
  const savedLine = stations
    .filter((station) => station.goalId === goal.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (savedLine.length > 0 && mode !== 'stations') {
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
      mode === 'stations'
        ? STATION_AGREEMENT(goal, savedLine.length > 0, unattended)
        : TICKET_AGREEMENT(goal)
    }`
  );
  const body = parts.join('\n\n');
  // A launch someone watches invokes the /goal command first.
  return unattended ? body : `/goal\n\n${body}`;
}

/**
 * Builds the prompt for a planning agent: a goal the conductor was told to
 * carry out has neither stations nor tickets, so there is nothing to work
 * yet. The agent only lays out the work in the form the goal's work mode
 * expects and stops; the conductor works what it left on the next tick.
 * Doing the work in the same run would leave it without evidence per step.
 */
export function buildGoalPlanningPrompt(goal: PmGoal): string {
  const plan =
    goal.workMode === 'tickets'
      ? 'This goal is set to ticket mode. Call list_epics and reuse a fitting epic, or ' +
        `create_epic with the name "${goal.name}". Then create the executable tickets in ` +
        `order with create_ticket (goalId: "${goal.id}"); a step that needs a person gets ` +
        'needsHumanSupervision: true.'
      : `Lay the work out as a line of stations with create_stations (goalId: "${goal.id}"), ` +
        'in the order it has to happen. Give each station a short imperative name and, ' +
        'where the result can be checked by machine, a predicate that checks it (for ' +
        'example {"type":"file_exists","glob":"..."}). A step only a person can do is a ' +
        'station with kind "human".';
  return [
    `# Plan goal: ${goal.name} (goalId: ${goal.id})`,
    READ_GOAL_FIRST(goal),
    ...(goal.goalPrompt.trim() ? [`## Goal instructions\n${goal.goalPrompt}`] : []),
    `## Your task\nThis goal has no work attached yet. Plan it, do not carry it out. ${plan} ` +
      'Cover the success criteria completely and keep each step small enough for one ' +
      'agent. Do not create sub-goals, do not mark anything done, do not call ' +
      'record_goal_run. Stop as soon as the plan is saved.',
  ].join('\n\n');
}
