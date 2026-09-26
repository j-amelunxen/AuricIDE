import { buildGoalLaunchPrompt } from '@/lib/goals/goalLaunchPrompt';
import { buildLaunchRequest } from '@/lib/notifications/launchRequest';
import type { PmGoal } from '@/lib/tauri/goals';
import type { ConductorTickContext } from './conductorTick';
import type { ConductorSlice } from './conductorTypes';

/**
 * Asks for one goal agent per launchable stations goal by writing a launch
 * request into the inbox (see `conductorStationGoals.ts` for why a request and
 * not a spawn). Capacity and budget are the run's own, shared with ticket
 * agents: a goal in flight takes a slot, and a goal counts against the budget
 * once, its retries do not. Returns whether anything was written.
 */
export async function requestGoalAgents(
  ctx: ConductorTickContext,
  launchable: PmGoal[],
  alreadyInFlight: number
): Promise<boolean> {
  const { get, set, cross, addDecision } = ctx;
  const full = cross();
  const projectPath = full.rootPath;
  if (!projectPath) return false;
  let inFlight = alreadyInFlight;
  let wrote = false;

  for (const goal of launchable) {
    const state = get();
    if (!state.conductorRunning) break;
    const capacity =
      state.conductorMaxConcurrent -
      Object.keys(state.conductorAssignments).length -
      Object.keys(state.conductorReviewAssignments).length -
      inFlight;
    if (capacity <= 0) break;

    const attempts = state.conductorGoalAttempts[goal.id] ?? 0;
    const isRetry = attempts > 0;
    if (
      state.conductorTicketBudget !== null &&
      !isRetry &&
      state.conductorRunSpawned >= state.conductorTicketBudget
    ) {
      continue;
    }

    // Count the attempt before the async write, so a concurrent tick sees it.
    set((s: ConductorSlice) => ({
      conductorGoalAttempts: { ...s.conductorGoalAttempts, [goal.id]: attempts + 1 },
      conductorRunSpawned: isRetry ? s.conductorRunSpawned : s.conductorRunSpawned + 1,
    }));
    inFlight += 1;
    wrote = true;

    const stored = await full.dispatchNotification?.(
      buildLaunchRequest({
        uid: crypto.randomUUID(),
        goalId: goal.id,
        goalName: goal.name,
        prompt: buildGoalLaunchPrompt(goal, full.goalStationsDraft ?? [], 'stations'),
        folder: projectPath,
        projectPath,
        title: `Conductor asks for an agent for goal "${goal.name}"`,
        provider: state.conductorProviderId ?? undefined,
        model: state.conductorModel || undefined,
      })
    );
    addDecision(
      stored
        ? {
            action: 'spawn',
            detail: `Asked for a goal agent for "${goal.name}" · starts from the inbox or under a launch grant`,
          }
        : { action: 'fail', detail: `Could not write the launch request for "${goal.name}"` }
    );
  }
  return wrote;
}
