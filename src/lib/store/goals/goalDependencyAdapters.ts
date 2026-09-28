/**
 * Adapts the store's row shapes (`PmGoal`, `PmGoalDependency`) to the plain
 * `DependencyGoal` / `GoalDependencyEdge` shapes `goalDependencies.ts` works
 * with, and re-exports its pure functions against those row shapes. Kept
 * separate from `goalDependencies.ts` (lead-owned, shared with Rust and MCP)
 * so the store's own conversions live on our side of that boundary.
 *
 * These are plain functions, not zustand selectors: a component calls them
 * with `goalsDraft`/`goalDependenciesDraft` already read from the store,
 * inside a `useMemo` where the result feeds a render. Wrapping one of these in
 * a selector that builds a fresh array every call would reintroduce the
 * unstable-selector render loop (React #185) the rest of the store avoids.
 */
import type { PmGoal, PmGoalDependency } from '../../tauri/goals';
import {
  bundleHold,
  bundleMembers,
  goalBlockers,
  introducedDependencyErrors,
  isGoalBlocked,
  siblingWaves,
  validateGoalDependencies,
  type DependencyGoal,
  type GoalBlocker,
  type GoalDependencyEdge,
  type GoalDependencyError,
} from '../../goals/goalDependencies';
import { getGoalDescendants } from './goalTreeHelpers';

export function toDependencyGoals(goals: readonly PmGoal[]): DependencyGoal[] {
  return goals.map((g) => ({ id: g.id, parentId: g.parentId, status: g.status, bundle: g.bundle }));
}

export function toDependencyEdges(edges: readonly PmGoalDependency[]): GoalDependencyEdge[] {
  return edges.map((e) => ({ goalId: e.goalId, dependsOnGoalId: e.dependsOnGoalId }));
}

export function validateGoalEdges(
  goals: readonly PmGoal[],
  edges: readonly GoalDependencyEdge[]
): GoalDependencyError[] {
  return validateGoalDependencies(toDependencyGoals(goals), edges);
}

export function getGoalBlockers(
  goals: readonly PmGoal[],
  edges: readonly PmGoalDependency[],
  goalId: string
): GoalBlocker[] {
  return goalBlockers(toDependencyGoals(goals), toDependencyEdges(edges), goalId);
}

/** Whether an edge (this goal's own, or an ancestor's) still holds `goalId` up. */
export function isGoalBlockedByDependency(
  goals: readonly PmGoal[],
  edges: readonly PmGoalDependency[],
  goalId: string
): boolean {
  return isGoalBlocked(toDependencyGoals(goals), toDependencyEdges(edges), goalId);
}

export function getSiblingWaves(
  goals: readonly PmGoal[],
  edges: readonly PmGoalDependency[],
  parentId: string | null
): string[][] {
  return siblingWaves(toDependencyGoals(goals), toDependencyEdges(edges), parentId);
}

/** Every goal in the same bundle as `goalId`, itself included. */
export function getBundleMembers(goals: readonly PmGoal[], goalId: string): string[] {
  return bundleMembers(toDependencyGoals(goals), goalId);
}

/** Bundle mates of `goalId` that have not met their own conditions yet. */
export function getBundleHold(
  goals: readonly PmGoal[],
  goalId: string,
  ownSatisfied: (id: string) => boolean
): string[] {
  return bundleHold(toDependencyGoals(goals), goalId, ownSatisfied);
}

/**
 * The errors an edit introduces against a `before` state — see
 * `introducedDependencyErrors`. Every write path (`addGoalDependency`,
 * `setGoalBundle`, and the rebase guard that recovers a draft a concurrent
 * write made invalid) rejects on this, never on the full validation, so a
 * pre-existing problem elsewhere in the tree never blocks an unrelated edit.
 */
export function getIntroducedDependencyErrors(
  before: { goals: readonly PmGoal[]; edges: readonly GoalDependencyEdge[] },
  after: { goals: readonly PmGoal[]; edges: readonly GoalDependencyEdge[] }
): GoalDependencyError[] {
  return introducedDependencyErrors(
    { goals: toDependencyGoals(before.goals), edges: before.edges },
    { goals: toDependencyGoals(after.goals), edges: after.edges }
  );
}

/** "waits for A, B" naming what currently holds `goalId` up, or null if it isn't. */
export function describeDependencyBlock(
  goals: readonly PmGoal[],
  edges: readonly PmGoalDependency[],
  goalId: string
): string | null {
  const blockers = getGoalBlockers(goals, edges, goalId);
  if (blockers.length === 0) return null;
  const names = [
    ...new Set(blockers.map((b) => goals.find((g) => g.id === b.goalId)?.name ?? b.goalId)),
  ];
  return `waits for ${names.join(', ')}`;
}

/**
 * One "<goal>" waits for <name>" line per blocked goal in `rootId`'s subtree
 * (itself included) — used when a run ends without progress, so the report
 * names the actual hold-up instead of only the raw "ticket is open" state a
 * blocked ticket is left in.
 */
export function describeSubtreeDependencyBlocks(
  goals: PmGoal[],
  edges: readonly PmGoalDependency[],
  rootId: string
): string[] {
  const root = goals.find((g) => g.id === rootId);
  const ids = [...(root ? [rootId] : []), ...getGoalDescendants(goals, rootId).map((g) => g.id)];
  const lines: string[] = [];
  for (const id of ids) {
    const reason = describeDependencyBlock(goals, edges, id);
    if (!reason) continue;
    const name = goals.find((g) => g.id === id)?.name ?? id;
    lines.push(`Goal "${name}" ${reason}`);
  }
  return lines;
}
