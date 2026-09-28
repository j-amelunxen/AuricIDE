import type { PmGoal } from '../tauri/goals';
import { normalizeBundle, type GoalBlocker } from '../goals/goalDependencies';

/**
 * Turns a goal's blockers into one short phrase, shared by the sub-goal plan
 * graph and the goal tree's chip so the two never word the same wait
 * differently. `getGoalBlockers` always expands a bundle edge to every
 * unreleased member (see `goalDependencies.ts`), so when those members are
 * the whole of one bundle, naming the bundle is more useful than listing
 * every member — otherwise it's the first blocker's name, plus a count.
 */
export function summarizeBlockers(
  goals: readonly PmGoal[],
  blockers: readonly GoalBlocker[]
): string | null {
  if (blockers.length === 0) return null;
  const byId = new Map(goals.map((g) => [g.id, g]));
  const blockerGoals = blockers
    .map((b) => byId.get(b.goalId))
    .filter((g): g is PmGoal => g !== undefined);
  if (blockerGoals.length === 0) return null;

  const bundle = normalizeBundle(blockerGoals[0].bundle);
  if (bundle !== null) {
    const parentId = blockerGoals[0].parentId;
    const isWholeBundle = blockerGoals.every(
      (g) => g.parentId === parentId && normalizeBundle(g.bundle) === bundle
    );
    const bundleSize = goals.filter(
      (g) => g.parentId === parentId && normalizeBundle(g.bundle) === bundle
    ).length;
    if (isWholeBundle && blockerGoals.length === bundleSize) {
      return `bundle ${bundle}`;
    }
  }

  const [first, ...rest] = blockerGoals;
  return rest.length > 0 ? `${first.name} +${rest.length}` : first.name;
}
