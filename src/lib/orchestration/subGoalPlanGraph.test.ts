import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalDependency } from '../tauri/goals';
import { buildSubGoalPlanGraph } from './subGoalPlanGraph';

const TS = '2026-01-10 10:00:00';

function goal(id: string, overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id,
    parentId: 'P',
    name: id,
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

const parent = goal('P', { id: 'P', parentId: null });

function edge(goalId: string, dependsOnGoalId: string): PmGoalDependency {
  return { id: `${goalId}->${dependsOnGoalId}`, goalId, dependsOnGoalId, createdAt: TS };
}

describe('buildSubGoalPlanGraph', () => {
  it('renders nothing for a goal with no children', () => {
    expect(buildSubGoalPlanGraph([parent], [], 'P')).toEqual({ groups: [], edges: [] });
  });

  it('renders nothing for a single child — there is no plan to draw yet', () => {
    const goals = [parent, goal('A')];
    expect(buildSubGoalPlanGraph(goals, [], 'P')).toEqual({ groups: [], edges: [] });
  });

  it('puts parallel children (no edge between them) in the same wave', () => {
    const goals = [parent, goal('A'), goal('B')];
    const { groups, edges } = buildSubGoalPlanGraph(goals, [], 'P');
    expect(edges).toEqual([]);
    expect(groups.map((g) => g.wave)).toEqual([0, 0]);
    expect(groups.map((g) => g.key)).toEqual(['goal:A', 'goal:B']);
    expect(groups.every((g) => g.bundleLabel === null)).toBe(true);
  });

  it('orders a serial chain into successive waves with a forward edge each', () => {
    const goals = [parent, goal('A'), goal('B'), goal('C')];
    const dependencies = [edge('B', 'A'), edge('C', 'B')];
    const { groups, edges } = buildSubGoalPlanGraph(goals, dependencies, 'P');
    expect(groups.map((g) => g.wave)).toEqual([0, 1, 2]);
    expect(edges).toEqual([
      { id: 'goal:A->goal:B', source: 'goal:A', target: 'goal:B' },
      { id: 'goal:B->goal:C', source: 'goal:B', target: 'goal:C' },
    ]);
  });

  it('collapses bundle siblings into one framed node', () => {
    const goals = [parent, goal('A'), goal('B', { bundle: 'api' }), goal('C', { bundle: 'api' })];
    const { groups } = buildSubGoalPlanGraph(goals, [], 'P');
    const bundleGroup = groups.find((g) => g.bundleLabel === 'api');
    expect(bundleGroup?.key).toBe('bundle:P:api');
    expect(bundleGroup?.members.map((m) => m.id)).toEqual(['B', 'C']);
    expect(groups.find((g) => g.key === 'goal:A')?.bundleLabel).toBeNull();
  });

  it('reports the blocking goal by name on the waiting member', () => {
    const goals = [parent, goal('A'), goal('B')];
    const dependencies = [edge('B', 'A')];
    const { groups } = buildSubGoalPlanGraph(goals, dependencies, 'P');
    const waiting = groups.find((g) => g.key === 'goal:B');
    expect(waiting?.members[0].waitingOnLabel).toBe('A');
    const clear = groups.find((g) => g.key === 'goal:A');
    expect(clear?.members[0].waitingOnLabel).toBeNull();
  });

  it('names the bundle instead of listing every member once all of it blocks', () => {
    const goals = [
      parent,
      goal('A'),
      goal('B', { bundle: 'api' }),
      goal('C', { bundle: 'api' }),
      goal('D'),
    ];
    const dependencies = [edge('D', 'B')]; // expands to the whole bundle: B and C
    const { groups } = buildSubGoalPlanGraph(goals, dependencies, 'P');
    const waiting = groups.find((g) => g.key === 'goal:D');
    expect(waiting?.members[0].waitingOnLabel).toBe('bundle api');
  });

  it('redraws a grandchild edge between the two siblings that own it', () => {
    // B1 depends on A; B1 is a child of B, a sibling of A. The edge should
    // connect A and B, not A and the invisible B1.
    const goals = [parent, goal('A'), goal('B'), goal('B1', { parentId: 'B' })];
    const dependencies = [edge('B1', 'A')];
    const { edges } = buildSubGoalPlanGraph(goals, dependencies, 'P');
    expect(edges).toEqual([{ id: 'goal:A->goal:B', source: 'goal:A', target: 'goal:B' }]);
  });

  it('drops an edge whose endpoint sits outside this subtree', () => {
    const goals = [parent, goal('A'), goal('B'), goal('Q', { parentId: null })];
    const dependencies = [edge('A', 'Q')];
    const { edges } = buildSubGoalPlanGraph(goals, dependencies, 'P');
    expect(edges).toEqual([]);
  });
});
