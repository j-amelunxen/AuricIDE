import type { PmGoal } from '@/lib/tauri/goals';
import { getGoalCompletion, getGoalDescendants } from '../goalsSlice';
import { getBundleMembers } from '../goals/goalDependencyAdapters';
import { ownGoalBlockers } from '../goals/goalSatisfaction';
import type { ConductorTickContext } from './conductorTick';

function depthIn(goals: PmGoal[]): (goal: PmGoal) => number {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  return (goal) => {
    let depth = 0;
    let parentId = goal.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return depth;
  };
}

/** A goal whose own agent is still running is not finished, whatever its checks say. */
function hasRunningAgent(ctx: ConductorTickContext, goalId: string): boolean {
  return (ctx.cross().agents ?? []).some(
    (a) => a.spawnedByGoalId === goalId && (a.status === 'running' || a.status === 'queued')
  );
}

/**
 * Closes every goal below the run's root that is finished, deepest first, and
 * returns the goal list as it stands afterwards. It runs at the start of every
 * tick, not only once the run is out of work: a goal that others depend on has
 * to be achieved before they are released, so a chain of sub-goals only runs
 * through in one run if each link is closed as soon as it is done.
 *
 * The root is left to the run's end check. A goal only closes from `active`
 * or `in_progress` (a goal in review waits for its verdict) and never while
 * one of its agents still runs, since a goal agent may still be adding to the
 * work it is judged by. A bundle member becomes achievable only once every
 * mate does (bundleHold in getGoalSatisfaction), so the whole bundle closes
 * in one step, and not while an agent still runs on any of them.
 */
function isAchievable(ctx: ConductorTickContext, goals: PmGoal[], goalId: string): boolean {
  const full = ctx.cross();
  return getGoalCompletion(
    goals,
    full.pmDraftTickets ?? [],
    full.requirementsDraft ?? [],
    full.goalRequirementLinksDraft ?? [],
    full.goalStationsDraft ?? [],
    goalId
  ).achievable;
}

/** Every open (not achieved/archived) member of `goalId`'s bundle, itself included. */
function openBundleMembers(goals: PmGoal[], goalId: string): string[] {
  return getBundleMembers(goals, goalId).filter((id) => {
    const status = goals.find((g) => g.id === id)?.status;
    return status !== 'achieved' && status !== 'archived';
  });
}

/**
 * Whether `goalId` could close on its own, by the same rule the run's own
 * target goal is held to: not `failed` (a human decision is owed, not a
 * quiet close), not `in_review` (still waiting on its verdict), no agent
 * still running on it, and its own conditions met — the bundle-recursion-free
 * check, since bundleHold itself is what decided the bundle is ready.
 */
function isCloseable(ctx: ConductorTickContext, goals: PmGoal[], goalId: string): boolean {
  const goal = goals.find((g) => g.id === goalId);
  if (!goal || goal.status === 'failed' || goal.status === 'in_review') return false;
  if (hasRunningAgent(ctx, goalId)) return false;
  const full = ctx.cross();
  return (
    ownGoalBlockers(
      goals,
      full.pmDraftTickets ?? [],
      full.requirementsDraft ?? [],
      full.goalRequirementLinksDraft ?? [],
      full.goalStationsDraft ?? [],
      goalId
    ).length === 0
  );
}

/**
 * The goals that close together with `goalId`: its whole bundle (or just
 * itself outside one), and only when EVERY open member of it could itself
 * close — a failed, in-review or still-running mate holds the whole bundle
 * open, exactly as it would if `goalId` itself were in that state.
 */
export function closableWith(ctx: ConductorTickContext, goals: PmGoal[], goalId: string): string[] {
  const open = openBundleMembers(goals, goalId);
  return open.every((id) => isCloseable(ctx, goals, id)) ? open : [];
}

/**
 * Why a bundle stays open despite `goalId`'s own conditions being met: one
 * line per member that keeps the whole thing from closing (see `closableWith`
 * — own-conditions-not-met mates are already named by bundleHold's own
 * blocker, so only the status/agent reasons are reported here).
 */
export function bundleHoldBlockers(
  ctx: ConductorTickContext,
  goals: PmGoal[],
  goalId: string
): string[] {
  const reasons: string[] = [];
  for (const id of openBundleMembers(goals, goalId)) {
    const goal = goals.find((g) => g.id === id);
    if (!goal) continue;
    if (goal.status === 'failed') reasons.push(`Bundle member "${goal.name}" failed`);
    else if (goal.status === 'in_review') reasons.push(`Bundle member "${goal.name}" is in review`);
    else if (hasRunningAgent(ctx, id)) {
      reasons.push(`Bundle member "${goal.name}" still has an agent running`);
    }
  }
  return reasons;
}

export function achieveFinishedDescendants(
  ctx: ConductorTickContext,
  goals: PmGoal[],
  rootId: string
): PmGoal[] {
  const full = ctx.cross();
  let working = goals;
  const achieved = new Set<string>();
  const depth = depthIn(goals);
  const descendants = getGoalDescendants(goals, rootId).sort((a, b) => depth(b) - depth(a));
  for (const descendant of descendants) {
    if (achieved.has(descendant.id)) continue;
    if (descendant.status !== 'active' && descendant.status !== 'in_progress') continue;
    if (!isAchievable(ctx, working, descendant.id)) continue;
    for (const id of closableWith(ctx, working, descendant.id)) {
      full.achieveGoal?.(id);
      achieved.add(id);
      const name = working.find((g) => g.id === id)?.name ?? id;
      ctx.addDecision({
        action: 'goal_achieved',
        detail: `Sub-goal "${name}" achieved · all checks green`,
      });
    }
    working = working.map((goal) =>
      achieved.has(goal.id) ? { ...goal, status: 'achieved' as const } : goal
    );
  }
  return working;
}
