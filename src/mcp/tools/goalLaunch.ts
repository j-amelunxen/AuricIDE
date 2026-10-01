import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import {
  buildGoalLaunchPrompt,
  buildGoalPlanningPrompt,
  buildMetaGoalSplitPrompt,
  type LaunchGoal,
  type LaunchStation,
} from '../../lib/goals/goalLaunchPrompt';
import type { GoalWorkMode } from '../../lib/goals/workMode';
import { getGoal, goalWorkMode, type GoalRow } from './goalsDb';
import { listStations } from './stations';
import { resolveGoalId } from './resolve';

/** What an agent for a goal can be asked to do; mirrors the buttons of the Goals panel. */
export const GOAL_LAUNCH_PURPOSES = ['work', 'plan', 'split'] as const;
export type GoalLaunchPurpose = (typeof GOAL_LAUNCH_PURPOSES)[number];

export interface GoalLaunchPrompt {
  goalId: string;
  purpose: GoalLaunchPurpose;
  /** Only for `work`: how the goal is worked, and why. */
  mode?: GoalWorkMode;
  modeReason?: string;
  unattended: boolean;
  prompt: string;
}

function launchGoal(row: GoalRow, workMode: LaunchGoal['workMode']): LaunchGoal {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    successCriteria: row.success_criteria,
    goalPrompt: row.goal_prompt,
    workMode,
  };
}

/**
 * The prompt the Goals panel would put in the spawn dialog for this goal,
 * built by the same functions (`src/lib/goals/goalLaunchPrompt.ts`) from the
 * project database instead of the store. An agent reads it, may adapt it, and
 * hands it to `request_agent_launch`.
 */
export function getGoalLaunchPrompt(
  db: Database.Database,
  goalId: string,
  purpose: GoalLaunchPurpose = 'work',
  unattended = false
): GoalLaunchPrompt {
  const row = getGoal(db, goalId);
  if (!row) throw new Error(`Goal '${goalId}' not found in this project`);
  const resolved = goalWorkMode(db, goalId);
  const goal = launchGoal(row, resolved.setting);
  const base = { goalId: row.id, purpose, unattended };

  if (purpose === 'plan') return { ...base, prompt: buildGoalPlanningPrompt(goal) };
  if (purpose === 'split') return { ...base, prompt: buildMetaGoalSplitPrompt(goal) };

  const stations: LaunchStation[] = listStations(db, row.id).map((s) => ({
    id: s.id,
    goalId: s.goal_id,
    name: s.name,
    kind: s.kind as LaunchStation['kind'],
    sortOrder: s.sort_order,
  }));
  return {
    ...base,
    mode: resolved.mode,
    modeReason: resolved.reason,
    prompt: buildGoalLaunchPrompt(goal, stations, resolved.mode, { unattended }),
  };
}

export function registerGoalLaunchTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'get_goal_launch_prompt',
    description:
      "Get the exact prompt the IDE's Goals panel would give an agent for this goal. purpose " +
      '"work" (default) carries the goal out in its work mode (stations or tickets; the mode ' +
      'and why come back too), "plan" lays out the work and stops, "split" breaks a meta-goal ' +
      'into child goals and tickets. unattended: true builds the variant for a headless run ' +
      '(no /goal command, human stations handed over). Read it, adapt it if you must, then ' +
      'pass it to request_agent_launch.',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or unique prefix)'),
      purpose: z.enum(GOAL_LAUNCH_PURPOSES).optional().describe('Default "work"'),
      unattended: z
        .boolean()
        .optional()
        .describe('Headless run nobody watches; only changes the "work" prompt'),
    }),
    execute: async ({ goalId, purpose, unattended }) =>
      JSON.stringify(
        getGoalLaunchPrompt(db, resolveGoalId(db, goalId), purpose ?? 'work', unattended ?? false),
        null,
        2
      ),
  });
}
