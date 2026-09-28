import type { PmGoal, PmGoalDependency } from '../tauri/goals';
import { normalizeBundle } from '../goals/goalDependencies';
import { getGoalBlockers, getGoalChildren, getSiblingWaves } from '../store/goalsSlice';
import { summarizeBlockers } from './blockerLabel';

/** One child goal inside a plan node — a bundle node holds more than one. */
export interface SubGoalPlanMember {
  id: string;
  name: string;
  status: PmGoal['status'];
  /** What still holds this one back — a name, "name +N", or "bundle <label>". Null once clear. */
  waitingOnLabel: string | null;
}

export interface SubGoalPlanGroup {
  /** Graph node id: `goal:<id>` for a lone child, `bundle:<parentId>:<label>` for a bundle. */
  key: string;
  bundleLabel: string | null;
  wave: number;
  members: SubGoalPlanMember[];
}

export interface SubGoalPlanEdge {
  id: string;
  /** The prerequisite's node key — work starts here. */
  source: string;
  /** The dependent's node key — waits on `source`. */
  target: string;
}

export interface SubGoalPlanGraph {
  groups: SubGoalPlanGroup[];
  edges: SubGoalPlanEdge[];
}

/**
 * Walks a goal up to the direct child of `parentId` that contains it, so a
 * dependency edge set on a grandchild still connects the two top-level
 * siblings that own it (see the "grandchild edge orders its siblings" fixture
 * in goalDependencies.fixtures.json). Returns null for a goal outside the
 * subtree — its edge is not part of this local view.
 */
function ownerChildOf(
  byId: Map<string, PmGoal>,
  childIds: ReadonlySet<string>,
  goalId: string
): string | null {
  let current = byId.get(goalId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (childIds.has(current.id)) return current.id;
    seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return null;
}

/**
 * Builds the read-only plan graph for one goal's direct children: one node
 * per child, bundle siblings collapsed into a single framed node, columns are
 * the topological waves from `getSiblingWaves`. Returns an empty graph for a
 * goal with fewer than two children — nothing there to plan around.
 */
export function buildSubGoalPlanGraph(
  goals: PmGoal[],
  dependencies: PmGoalDependency[],
  parentId: string
): SubGoalPlanGraph {
  const children = getGoalChildren(goals, parentId);
  if (children.length < 2) return { groups: [], edges: [] };

  const byId = new Map(goals.map((g) => [g.id, g]));
  const childIds = new Set(children.map((c) => c.id));

  const waves = getSiblingWaves(goals, dependencies, parentId);
  const waveOf = new Map<string, number>();
  waves.forEach((wave, index) => wave.forEach((id) => waveOf.set(id, index)));

  const groupKeyOf = new Map<string, string>();
  const groupOrder: string[] = [];
  const groupMembers = new Map<string, PmGoal[]>();
  for (const child of children) {
    const bundle = normalizeBundle(child.bundle);
    const key = bundle === null ? `goal:${child.id}` : `bundle:${parentId}:${bundle}`;
    groupKeyOf.set(child.id, key);
    let members = groupMembers.get(key);
    if (!members) {
      members = [];
      groupOrder.push(key);
      groupMembers.set(key, members);
    }
    members.push(child);
  }

  const groups: SubGoalPlanGroup[] = groupOrder.map((key) => {
    const members = groupMembers.get(key) as PmGoal[];
    return {
      key,
      bundleLabel: normalizeBundle(members[0].bundle),
      wave: Math.min(...members.map((m) => waveOf.get(m.id) ?? 0)),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        waitingOnLabel: summarizeBlockers(goals, getGoalBlockers(goals, dependencies, m.id)),
      })),
    };
  });

  const edgeIds = new Set<string>();
  const edges: SubGoalPlanEdge[] = [];
  for (const dep of dependencies) {
    const sourceChild = ownerChildOf(byId, childIds, dep.goalId);
    const targetChild = ownerChildOf(byId, childIds, dep.dependsOnGoalId);
    if (!sourceChild || !targetChild) continue;
    const sourceKey = groupKeyOf.get(sourceChild) as string;
    const targetKey = groupKeyOf.get(targetChild) as string;
    if (sourceKey === targetKey) continue;
    // Arrow points from the prerequisite to the dependent — the direction
    // work actually flows, and the direction dagre ranks columns by.
    const id = `${targetKey}->${sourceKey}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({ id, source: targetKey, target: sourceKey });
  }

  return { groups, edges };
}
