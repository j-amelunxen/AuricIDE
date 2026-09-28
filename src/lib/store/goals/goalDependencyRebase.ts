/**
 * The way out of a stuck goal-dependency draft: a local, unsaved edge or
 * bundle change that a concurrent write (MCP, another window) has since made
 * invalid. Without this, the draft keeps sending the same now-bad edit on
 * every retry, and the backend keeps rejecting it — a save that can never
 * succeed again. `dropIntroducedDependencyDrafts` drops exactly the local
 * additions responsible (edge removed, bundle label reset to the persisted
 * value), never a problem that was already there before the local edit.
 */
import type { PmGoal, PmGoalDependency } from '../../tauri/goals';
import { normalizeBundle } from '../../goals/goalDependencies';
import { getIntroducedDependencyErrors, toDependencyEdges } from './goalDependencyAdapters';

export interface DependencyDraftRepair {
  goals: PmGoal[];
  edges: PmGoalDependency[];
  droppedEdgeIds: string[];
  resetBundleGoalIds: string[];
}

/** How many errors `candidate` introduces against `fresh` — lower is better. */
function introducedCount(
  fresh: { goals: readonly PmGoal[]; edgesPlain: ReturnType<typeof toDependencyEdges> },
  candidate: { goals: PmGoal[]; edges: PmGoalDependency[] }
): number {
  return getIntroducedDependencyErrors(
    { goals: fresh.goals, edges: fresh.edgesPlain },
    { goals: candidate.goals, edges: toDependencyEdges(candidate.edges) }
  ).length;
}

export function dropIntroducedDependencyDrafts(
  fresh: { goals: readonly PmGoal[]; edges: readonly PmGoalDependency[] },
  draft: { goals: PmGoal[]; edges: PmGoalDependency[] }
): DependencyDraftRepair {
  let goals = draft.goals;
  let edges = draft.edges;
  const droppedEdgeIds: string[] = [];
  const resetBundleGoalIds: string[] = [];
  const freshEdgeIds = new Set(fresh.edges.map((e) => e.id));
  const freshBundleById = new Map(fresh.goals.map((g) => [g.id, normalizeBundle(g.bundle)]));
  const freshPlain = { goals: fresh.goals, edgesPlain: toDependencyEdges(fresh.edges) };

  // Which edge validateGoalDependencies blames for a cycle depends on
  // processing order, not on which side is "ours" — a fresh edge can end up
  // named instead of the local one that actually created the problem. So
  // rather than trust the error's own goalId/dependsOnGoalId, each candidate
  // removal is tried and kept only if it measurably helps. At most one
  // removal per local edit — bounded, so a problem already in `fresh` itself
  // (never "introduced" by the draft) can't turn this into a loop.
  const guardLimit = edges.length + goals.length + 1;
  for (let guard = 0; guard < guardLimit; guard += 1) {
    const before = introducedCount(freshPlain, { goals, edges });
    if (before === 0) break;

    const localOnlyEdges = edges.filter((e) => !freshEdgeIds.has(e.id));
    const edgeToDrop = localOnlyEdges.find(
      (candidate) =>
        introducedCount(freshPlain, { goals, edges: edges.filter((e) => e.id !== candidate.id) }) <
        before
    );
    if (edgeToDrop) {
      edges = edges.filter((e) => e.id !== edgeToDrop.id);
      droppedEdgeIds.push(edgeToDrop.id);
      continue;
    }

    const bundleEditedIds = goals
      .filter((g) => {
        const freshBundle = freshBundleById.get(g.id);
        return freshBundle !== undefined && normalizeBundle(g.bundle) !== freshBundle;
      })
      .map((g) => g.id);
    const idToReset = bundleEditedIds.find((id) => {
      const reverted = goals.map((g) =>
        g.id === id ? { ...g, bundle: freshBundleById.get(id) ?? null } : g
      );
      return introducedCount(freshPlain, { goals: reverted, edges }) < before;
    });
    if (idToReset) {
      const freshBundle = freshBundleById.get(idToReset) ?? null;
      goals = goals.map((g) => (g.id === idToReset ? { ...g, bundle: freshBundle } : g));
      resetBundleGoalIds.push(idToReset);
      continue;
    }

    // Nothing local, tried alone, measurably helps — leave the rest as is
    // rather than loop without progress.
    break;
  }

  return { goals, edges, droppedEdgeIds, resetBundleGoalIds };
}
