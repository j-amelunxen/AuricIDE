import { buildGoalLaunchPrompt, buildGoalPlanningPrompt } from '@/lib/goals/goalLaunchPrompt';
import type { PmGoal } from '@/lib/tauri/goals';
import { modelForPower } from './conductorHelpers';
import type { ConductorTickContext } from './conductorTick';
import type { ConductorSlice } from './conductorTypes';

/**
 * What a goal-level agent is spawned for: `work` a stations goal's own line,
 * or `plan` a goal that has no work attached yet. Each keeps its own attempt
 * ledger, so a goal that was planned still gets its full tries at the work.
 */
export type GoalAgentPurpose = 'work' | 'plan';

const ATTEMPTS_KEY = {
  work: 'conductorGoalAttempts',
  plan: 'conductorPlanAttempts',
} as const satisfies Record<GoalAgentPurpose, keyof ConductorSlice>;

const LABEL: Record<GoalAgentPurpose, string> = { work: 'goal', plan: 'planning' };

function freeSlots(state: ConductorSlice, inFlight: number): number {
  return (
    state.conductorMaxConcurrent -
    Object.keys(state.conductorAssignments).length -
    Object.keys(state.conductorReviewAssignments).length -
    inFlight
  );
}

/** Any earlier agent for the goal, of either purpose, already bought it with the budget. */
function isRetry(state: ConductorSlice, goalId: string): boolean {
  return (
    (state.conductorGoalAttempts[goalId] ?? 0) + (state.conductorPlanAttempts[goalId] ?? 0) > 0
  );
}

function budgetSpent(state: ConductorSlice): boolean {
  return (
    state.conductorTicketBudget !== null && state.conductorRunSpawned >= state.conductorTicketBudget
  );
}

function taskFor(ctx: ConductorTickContext, goal: PmGoal, purpose: GoalAgentPurpose): string {
  return purpose === 'plan'
    ? buildGoalPlanningPrompt(goal)
    : buildGoalLaunchPrompt(goal, ctx.cross().goalStationsDraft ?? [], 'stations');
}

/** Starts one agent; resolves to its id, or null when the spawn did not happen. */
async function spawnOne(
  ctx: ConductorTickContext,
  goal: PmGoal,
  purpose: GoalAgentPurpose,
  projectPath: string
): Promise<string | null> {
  const state = ctx.get();
  try {
    const agent = await ctx.cross().spawnNewAgent?.({
      name: `conductor:${purpose === 'plan' ? 'plan' : 'goal'}:${goal.name.slice(0, 40)}`,
      // A goal has no model power of its own; same default as a ticket without one.
      model: state.conductorModel || modelForPower(undefined),
      provider: state.conductorProviderId ?? undefined,
      task: taskFor(ctx, goal, purpose),
      projectPath,
      cwd: projectPath,
      headless: true,
      spawnedByGoalId: goal.id,
      runSource: 'conductor',
    });
    return agent?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Spawns one headless agent per goal, the way ticket agents are spawned.
 * Pressing Start on a goal is the approval for its whole tree, so there is no
 * launch request waiting for a second click. Capacity and budget are the
 * run's own, shared with ticket agents: a goal in flight takes a slot, and a
 * goal counts against the budget once, its retries and its planning do not
 * add to it. The agent's `spawnedByGoalId` is how the next tick sees it is
 * still running. Returns how many agents were started.
 */
export async function spawnGoalAgents(
  ctx: ConductorTickContext,
  goals: PmGoal[],
  purpose: GoalAgentPurpose,
  alreadyInFlight: number
): Promise<number> {
  const { get, set, addDecision } = ctx;
  const projectPath = ctx.cross().rootPath;
  if (!projectPath) return 0;
  const key = ATTEMPTS_KEY[purpose];
  let inFlight = alreadyInFlight;
  let started = 0;

  for (const goal of goals) {
    const state = get();
    if (!state.conductorRunning || freeSlots(state, inFlight) <= 0) break;
    const retry = isRetry(state, goal.id);
    if (!retry && budgetSpent(state)) continue;

    // Count the attempt before the async spawn, so a concurrent tick sees it.
    set((s: ConductorSlice) => ({
      [key]: { ...s[key], [goal.id]: (s[key][goal.id] ?? 0) + 1 },
      conductorRunSpawned: retry ? s.conductorRunSpawned : s.conductorRunSpawned + 1,
    }));
    const agentId = await spawnOne(ctx, goal, purpose, projectPath);
    if (!agentId) {
      addDecision({
        action: 'fail',
        detail: `Could not start a ${LABEL[purpose]} agent for "${goal.name}"`,
      });
      continue;
    }
    inFlight += 1;
    started += 1;
    addDecision({
      action: 'spawn',
      detail:
        purpose === 'plan'
          ? `Planning agent ${agentId} lays out "${goal.name}", which has no work yet`
          : `Goal agent ${agentId} works the stations of "${goal.name}"`,
    });
  }
  return started;
}
