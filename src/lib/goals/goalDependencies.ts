/**
 * Dependencies between goals: what runs serially, what runs in parallel, and
 * what has to be finished together. One definition, shared by the store, the
 * conductor, the MCP server and the graphs. `src-tauri/src/database/goal_deps.rs`
 * mirrors `validateGoalDependencies`; both run `goalDependencies.fixtures.json`.
 *
 * - An edge `goalId → dependsOnGoalId` blocks the goal until the target is
 *   `achieved` or `archived` (dropped on purpose). A `failed` target keeps
 *   blocking: work built on a failed base needs a human decision first, not a
 *   quiet start. Blocking is inherited: a blocked goal
 *   blocks its whole subtree and the tickets in it.
 * - No edge between two goals means they may run in parallel. That is the
 *   default, so goals from before this existed behave as they always did.
 * - A bundle is a label on sibling goals (same parent, same `bundle`). Waiting
 *   for one member waits for all of them, and a member is only achieved once
 *   every member has met its own conditions — they close together.
 * - Waves are derived, never stored: topological levels of a parent's children,
 *   bundles kept in one wave. They drive the plan graph.
 */
import type { GoalStatus } from '../tauri/goals';

export interface DependencyGoal {
  id: string;
  parentId: string | null;
  status: GoalStatus;
  bundle?: string | null;
}

export interface GoalDependencyEdge {
  goalId: string;
  dependsOnGoalId: string;
}

export type GoalDependencyErrorCode =
  'unknown-goal' | 'self' | 'ancestor' | 'descendant' | 'same-bundle' | 'cycle';

export interface GoalDependencyError {
  code: GoalDependencyErrorCode;
  goalId: string;
  dependsOnGoalId: string;
  /** For `cycle`: the goal ids along the loop, first id repeated at the end. */
  path?: string[];
  message: string;
}

const RELEASING: ReadonlySet<GoalStatus> = new Set<GoalStatus>(['achieved', 'archived']);

/** Whether a dependency on a goal in this status no longer holds anyone up. */
export function releasesDependents(status: GoalStatus): boolean {
  return RELEASING.has(status);
}

/** Blank labels are no bundle; labels compare trimmed. */
export function normalizeBundle(bundle: string | null | undefined): string | null {
  const trimmed = (bundle ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

interface Index {
  byId: Map<string, DependencyGoal>;
  children: Map<string | null, DependencyGoal[]>;
}

function buildIndex(goals: readonly DependencyGoal[]): Index {
  const byId = new Map<string, DependencyGoal>();
  const children = new Map<string | null, DependencyGoal[]>();
  for (const goal of goals) {
    byId.set(goal.id, goal);
    const parent = goal.parentId ?? null;
    const list = children.get(parent) ?? [];
    list.push(goal);
    children.set(parent, list);
  }
  return { byId, children };
}

function ancestorsOf(index: Index, goalId: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>([goalId]);
  let current = index.byId.get(goalId)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    result.push(current);
    seen.add(current);
    current = index.byId.get(current)?.parentId ?? null;
  }
  return result;
}

function descendantsOf(index: Index, goalId: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>([goalId]);
  const stack = [goalId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const child of index.children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

/** Every goal in the same bundle as `goalId`, itself included, in input order. */
function bundleMembersIn(index: Index, goalId: string): string[] {
  const goal = index.byId.get(goalId);
  const bundle = normalizeBundle(goal?.bundle);
  if (!goal || bundle === null) return [goalId];
  return (index.children.get(goal.parentId ?? null) ?? [])
    .filter((g) => normalizeBundle(g.bundle) === bundle)
    .map((g) => g.id);
}

export function bundleMembers(goals: readonly DependencyGoal[], goalId: string): string[] {
  return bundleMembersIn(buildIndex(goals), goalId);
}

/** Node key in the waits-for graph: a bundle collapses into one node. */
function nodeKey(index: Index, goalId: string): string {
  const goal = index.byId.get(goalId);
  const bundle = normalizeBundle(goal?.bundle);
  if (!goal || bundle === null) return goalId;
  return `bundle:${goal.parentId ?? ''}:${bundle}`;
}

/**
 * The waits-for graph over bundle-collapsed nodes has three kinds of arc:
 *   own edge       G → D   (G waits for D)
 *   completion     P → C   (a parent is achieved only after its children)
 *   inheritance    C → D   for every own edge P → D of an ancestor P of C
 * A loop is a deadlock, whichever kind of arc closes it. Own edges are added
 * one at a time, in input order, each with the arcs it implies; an edge whose
 * arcs would close a loop is rejected and left out. That makes "which edge
 * gets the error" deterministic, which the Rust twin relies on.
 */
class WaitsFor {
  private readonly arcs = new Map<string, Set<string>>();

  add(from: string, to: string): void {
    const set = this.arcs.get(from) ?? new Set<string>();
    set.add(to);
    this.arcs.set(from, set);
  }

  /** Node keys from `from` to `to` inclusive, or null. */
  path(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const previous = new Map<string, string>();
    const queue = [from];
    const seen = new Set<string>([from]);
    while (queue.length > 0) {
      const node = queue.shift() as string;
      for (const next of this.arcs.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        previous.set(next, node);
        if (next === to) {
          const result = [to];
          let cursor = to;
          while (cursor !== from) {
            cursor = previous.get(cursor) as string;
            result.unshift(cursor);
          }
          return result;
        }
        queue.push(next);
      }
    }
    return null;
  }
}

function nodeLabel(key: string): string {
  return key.startsWith('bundle:') ? `[${key.slice(key.lastIndexOf(':') + 1)}]` : key;
}

function structuralError(
  index: Index,
  edge: GoalDependencyEdge
): { code: GoalDependencyErrorCode; message: string } | null {
  const { goalId, dependsOnGoalId } = edge;
  if (!index.byId.has(goalId) || !index.byId.has(dependsOnGoalId)) {
    return {
      code: 'unknown-goal',
      message: `Unknown goal in dependency ${goalId} → ${dependsOnGoalId}`,
    };
  }
  if (goalId === dependsOnGoalId) {
    return { code: 'self', message: `Goal ${goalId} cannot depend on itself` };
  }
  if (ancestorsOf(index, goalId).includes(dependsOnGoalId)) {
    return {
      code: 'ancestor',
      message: `Goal ${goalId} cannot wait for its ancestor ${dependsOnGoalId}: the ancestor waits for it`,
    };
  }
  if (descendantsOf(index, goalId).includes(dependsOnGoalId)) {
    return {
      code: 'descendant',
      message: `Goal ${goalId} cannot wait for its descendant ${dependsOnGoalId}: it already contains it`,
    };
  }
  if (nodeKey(index, goalId) === nodeKey(index, dependsOnGoalId)) {
    return {
      code: 'same-bundle',
      message: `Goals ${goalId} and ${dependsOnGoalId} are in the same bundle; members run in parallel`,
    };
  }
  return null;
}

/**
 * Checks a whole edge set against a goal tree. Returns one error per rejected
 * edge, in edge order; an empty list means the plan is runnable.
 */
export function validateGoalDependencies(
  goals: readonly DependencyGoal[],
  edges: readonly GoalDependencyEdge[]
): GoalDependencyError[] {
  const index = buildIndex(goals);
  const graph = new WaitsFor();
  for (const goal of index.byId.values()) {
    if (goal.parentId !== null && index.byId.has(goal.parentId)) {
      graph.add(nodeKey(index, goal.parentId), nodeKey(index, goal.id));
    }
  }
  const errors: GoalDependencyError[] = [];
  for (const edge of edges) {
    const structural = structuralError(index, edge);
    if (structural) {
      errors.push({ ...structural, goalId: edge.goalId, dependsOnGoalId: edge.dependsOnGoalId });
      continue;
    }
    const target = nodeKey(index, edge.dependsOnGoalId);
    const sources = [edge.goalId, ...descendantsOf(index, edge.goalId)].map((id) =>
      nodeKey(index, id)
    );
    let loop: string[] | null = null;
    for (const source of sources) {
      const back = graph.path(target, source);
      if (back) {
        loop = [source, ...back];
        break;
      }
    }
    if (loop) {
      const labels = loop.map(nodeLabel);
      errors.push({
        code: 'cycle',
        goalId: edge.goalId,
        dependsOnGoalId: edge.dependsOnGoalId,
        path: labels,
        message: `Cycle: ${labels.join(' → ')}`,
      });
      continue;
    }
    for (const source of sources) graph.add(source, target);
  }
  return errors;
}

export interface GoalBlocker {
  /** The goal that is not closed yet. */
  goalId: string;
  /** The goal whose own edge causes the wait: the goal itself or an ancestor. */
  viaGoalId: string;
}

/**
 * What keeps `goalId` from starting: every open goal it waits for, through its
 * own edges or an ancestor's, with bundle targets expanded to all members.
 */
export function goalBlockers(
  goals: readonly DependencyGoal[],
  edges: readonly GoalDependencyEdge[],
  goalId: string
): GoalBlocker[] {
  const index = buildIndex(goals);
  if (!index.byId.has(goalId)) return [];
  const result: GoalBlocker[] = [];
  const seen = new Set<string>();
  for (const via of [goalId, ...ancestorsOf(index, goalId)]) {
    for (const edge of edges) {
      if (edge.goalId !== via || !index.byId.has(edge.dependsOnGoalId)) continue;
      for (const member of bundleMembersIn(index, edge.dependsOnGoalId)) {
        const target = index.byId.get(member) as DependencyGoal;
        if (releasesDependents(target.status) || seen.has(member)) continue;
        seen.add(member);
        result.push({ goalId: member, viaGoalId: via });
      }
    }
  }
  return result;
}

export function isGoalBlocked(
  goals: readonly DependencyGoal[],
  edges: readonly GoalDependencyEdge[],
  goalId: string
): boolean {
  return goalBlockers(goals, edges, goalId).length > 0;
}

/**
 * Bundle members (other than `goalId`) that have not met their own conditions
 * yet. `ownSatisfied` answers for a single goal without looking at its bundle —
 * asking the bundle-aware answer here would make members wait on each other.
 */
export function bundleHold(
  goals: readonly DependencyGoal[],
  goalId: string,
  ownSatisfied: (id: string) => boolean
): string[] {
  const index = buildIndex(goals);
  return bundleMembersIn(index, goalId).filter((id) => {
    if (id === goalId) return false;
    const member = index.byId.get(id) as DependencyGoal;
    if (releasesDependents(member.status)) return false;
    return !ownSatisfied(id);
  });
}

/**
 * Longest-path level per node: 0 for nodes that wait on nothing, otherwise one
 * past the latest node they wait on. Nodes stuck in a loop (only possible with
 * corrupted data) all land in the level after the last one that resolved.
 */
function waveLevels(
  keys: readonly string[],
  waitsOn: Map<string, Set<string>>
): Map<string, number> {
  const level = new Map<string, number>();
  let remaining = keys.slice();
  let wave = 0;
  while (remaining.length > 0) {
    const ready = remaining.filter((k) => [...(waitsOn.get(k) ?? [])].every((d) => level.has(d)));
    const placed = ready.length > 0 ? ready : remaining;
    for (const k of placed) level.set(k, wave);
    remaining = remaining.filter((k) => !placed.includes(k));
    wave += 1;
  }
  return level;
}

/**
 * The children of `parentId` as topological waves: wave 0 can start at once,
 * wave n waits for something in an earlier wave. A child waits for a sibling
 * when any goal in its subtree has an edge into that sibling's subtree. Bundle
 * members always share a wave. Ids keep sibling order inside each wave.
 * Cyclic leftovers (invalid data) land in one final wave rather than vanish.
 */
export function siblingWaves(
  goals: readonly DependencyGoal[],
  edges: readonly GoalDependencyEdge[],
  parentId: string | null
): string[][] {
  const index = buildIndex(goals);
  const siblings = index.children.get(parentId) ?? [];
  if (siblings.length === 0) return [];

  const ownerOf = new Map<string, string>();
  for (const sibling of siblings) {
    const key = nodeKey(index, sibling.id);
    ownerOf.set(sibling.id, key);
    for (const d of descendantsOf(index, sibling.id)) ownerOf.set(d, key);
  }
  const keys = [...new Set(siblings.map((s) => nodeKey(index, s.id)))];
  const waitsOn = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  for (const edge of edges) {
    const from = ownerOf.get(edge.goalId);
    const to = ownerOf.get(edge.dependsOnGoalId);
    if (from && to && from !== to) waitsOn.get(from)?.add(to);
  }

  const level = waveLevels(keys, waitsOn);

  const waves: string[][] = [];
  for (const sibling of siblings) {
    const l = level.get(nodeKey(index, sibling.id)) as number;
    (waves[l] ??= []).push(sibling.id);
  }
  return waves.filter((w) => w !== undefined);
}

function errorKey(error: GoalDependencyError): string {
  return `${error.code}\u0000${error.goalId}\u0000${error.dependsOnGoalId}`;
}

/**
 * The errors a change introduces: those in `after` that `before` did not have.
 * Every write path rejects on this, never on the full list — otherwise one bad
 * row that reached the database by any route (an older build, a hand edit)
 * would refuse every later save, including saves that do not touch it.
 * Matching is by code and edge, so a pre-existing problem stays tolerated
 * until someone touches it, and is never reported as the caller's fault.
 */
export function introducedDependencyErrors(
  before: { goals: readonly DependencyGoal[]; edges: readonly GoalDependencyEdge[] },
  after: { goals: readonly DependencyGoal[]; edges: readonly GoalDependencyEdge[] }
): GoalDependencyError[] {
  const existing = new Set(validateGoalDependencies(before.goals, before.edges).map(errorKey));
  return validateGoalDependencies(after.goals, after.edges).filter(
    (error) => !existing.has(errorKey(error))
  );
}
