import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalDependency } from '../../tauri/goals';
import {
  describeDependencyBlock,
  describeSubtreeDependencyBlocks,
  getBundleHold,
  getBundleMembers,
  getGoalBlockers,
  getIntroducedDependencyErrors,
  getSiblingWaves,
  isGoalBlockedByDependency,
  validateGoalEdges,
} from './goalDependencyAdapters';

function goal(overrides: Partial<PmGoal> & { id: string }): PmGoal {
  return {
    parentId: null,
    name: overrides.id,
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function edge(goalId: string, dependsOnGoalId: string): PmGoalDependency {
  return {
    id: `${goalId}->${dependsOnGoalId}`,
    goalId,
    dependsOnGoalId,
    createdAt: '2026-01-01 00:00:00',
  };
}

describe('goalDependencyAdapters', () => {
  it('carries bundle and status through to the blocking check', () => {
    const goals = [goal({ id: 'A', status: 'active' }), goal({ id: 'B', status: 'active' })];
    const edges = [edge('B', 'A')];
    expect(isGoalBlockedByDependency(goals, edges, 'B')).toBe(true);
    expect(isGoalBlockedByDependency(goals, edges, 'A')).toBe(false);

    const achieved = goals.map((g) => (g.id === 'A' ? { ...g, status: 'achieved' as const } : g));
    expect(isGoalBlockedByDependency(achieved, edges, 'B')).toBe(false);
  });

  it('treats a missing bundle field the same as no bundle, unlike an empty string', () => {
    const noField = [goal({ id: 'A' }), goal({ id: 'B' })];
    const blankField = [goal({ id: 'A', bundle: '' }), goal({ id: 'B', bundle: '  ' })];
    expect(getBundleMembers(noField, 'A')).toEqual(['A']);
    expect(getBundleMembers(blankField, 'A')).toEqual(['A']);

    const bundled = [goal({ id: 'A', bundle: 'api' }), goal({ id: 'B', bundle: 'api' })];
    expect(getBundleMembers(bundled, 'A').sort()).toEqual(['A', 'B']);
  });

  it('goalBlockers names the goal-row objects it was actually given, expanded to bundle mates', () => {
    const goals = [
      goal({ id: 'A', status: 'active' }),
      goal({ id: 'B', status: 'active', bundle: 'api' }),
      goal({ id: 'C', status: 'active', bundle: 'api' }),
      goal({ id: 'D', status: 'active' }),
    ];
    const edges = [edge('D', 'B')];
    const blockers = getGoalBlockers(goals, edges, 'D');
    expect(blockers.map((b) => b.goalId).sort()).toEqual(['B', 'C']);
  });

  it('waves and validation reject the same edge set the pure module would', () => {
    const goals = [goal({ id: 'A' }), goal({ id: 'B' })];
    expect(validateGoalEdges(goals, [{ goalId: 'A', dependsOnGoalId: 'A' }])).toMatchObject([
      { code: 'self' },
    ]);
    expect(getSiblingWaves(goals, [edge('B', 'A')], null)).toEqual([['A'], ['B']]);
  });

  it('bundleHold reports mates that have not met their own conditions, never itself', () => {
    const goals = [
      goal({ id: 'A', status: 'active', bundle: 'x' }),
      goal({ id: 'B', status: 'active', bundle: 'x' }),
    ];
    const doneIds = new Set(['A']);
    expect(getBundleHold(goals, 'A', (id) => doneIds.has(id))).toEqual(['B']);
    expect(getBundleHold(goals, 'B', (id) => doneIds.has(id))).toEqual([]);
  });

  it('getIntroducedDependencyErrors tolerates a problem already present before the change', () => {
    const goals = [goal({ id: 'A' }), goal({ id: 'B' }), goal({ id: 'C' })];
    // A pre-existing cycle between A and B — not this edit's problem.
    const before = [edge('A', 'B'), edge('B', 'A')];
    const after = [...before, edge('C', 'A')];
    expect(
      getIntroducedDependencyErrors({ goals, edges: before }, { goals, edges: after })
    ).toEqual([]);
  });

  it('getIntroducedDependencyErrors reports a genuinely new problem', () => {
    const goals = [goal({ id: 'A' }), goal({ id: 'B' })];
    const before = [edge('B', 'A')];
    const after = [...before, edge('A', 'B')];
    const introduced = getIntroducedDependencyErrors(
      { goals, edges: before },
      { goals, edges: after }
    );
    expect(introduced).toHaveLength(1);
    expect(introduced[0].code).toBe('cycle');
  });

  it('describeDependencyBlock names the goal actually holding things up', () => {
    const goals = [goal({ id: 'A', status: 'in_progress', name: 'Base' }), goal({ id: 'B' })];
    const edges = [edge('B', 'A')];
    expect(describeDependencyBlock(goals, edges, 'B')).toBe('waits for Base');
    expect(describeDependencyBlock(goals, edges, 'A')).toBeNull();
  });

  it('describeSubtreeDependencyBlocks reports every blocked goal in scope, root included', () => {
    const goals = [
      goal({ id: 'root', name: 'Root' }),
      goal({ id: 'child', parentId: 'root', name: 'Child' }),
      goal({ id: 'sibling', name: 'Sibling', status: 'in_progress' }),
    ];
    const edges = [edge('root', 'sibling'), edge('child', 'sibling')];
    const lines = describeSubtreeDependencyBlocks(goals, edges, 'root');
    expect(lines).toEqual(['Goal "Root" waits for Sibling', 'Goal "Child" waits for Sibling']);
  });
});
