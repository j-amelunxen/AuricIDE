import { describe, expect, it } from 'vitest';
import fixtures from './goalDependencies.fixtures.json';
import {
  bundleHold,
  bundleMembers,
  goalBlockers,
  introducedDependencyErrors,
  isGoalBlocked,
  siblingWaves,
  validateGoalDependencies,
  type DependencyGoal,
  type GoalDependencyEdge,
} from './goalDependencies';

interface FixtureCase {
  name: string;
  goals: DependencyGoal[];
  edges: GoalDependencyEdge[];
  errors: Array<{ goalId: string; dependsOnGoalId: string; code: string }>;
  blocked?: Record<string, boolean>;
  waves?: Record<string, string[][]>;
}

const cases = fixtures.cases as FixtureCase[];

describe('goal dependencies — shared contract', () => {
  // src-tauri/src/database/goal_deps.rs runs the same `errors` over the same
  // file; a case green here and red there means the two sides disagree.
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const errors = validateGoalDependencies(c.goals, c.edges).map((e) => ({
      goalId: e.goalId,
      dependsOnGoalId: e.dependsOnGoalId,
      code: e.code,
    }));
    expect(errors).toEqual(c.errors);

    for (const [id, blocked] of Object.entries(c.blocked ?? {})) {
      expect(isGoalBlocked(c.goals, c.edges, id), `blocked(${id})`).toBe(blocked);
    }
    for (const [parent, waves] of Object.entries(c.waves ?? {})) {
      expect(siblingWaves(c.goals, c.edges, parent)).toEqual(waves);
    }
  });
});

describe('goal dependencies — details the fixtures do not carry', () => {
  const goals: DependencyGoal[] = [
    { id: 'P', parentId: null, status: 'active' },
    { id: 'A', parentId: 'P', status: 'active' },
    { id: 'B', parentId: 'P', status: 'active', bundle: 'api' },
    { id: 'C', parentId: 'P', status: 'active', bundle: 'api' },
    { id: 'D', parentId: 'P', status: 'active' },
    { id: 'D1', parentId: 'D', status: 'active' },
  ];

  it('names the whole loop in a cycle message', () => {
    const [error] = validateGoalDependencies(goals, [
      { goalId: 'B', dependsOnGoalId: 'A' },
      { goalId: 'A', dependsOnGoalId: 'D' },
      { goalId: 'D', dependsOnGoalId: 'C' },
    ]);
    expect(error.code).toBe('cycle');
    expect(error.path).toEqual(['D', '[api]', 'A', 'D']);
    expect(error.message).toBe('Cycle: D → [api] → A → D');
  });

  it('reports which edge makes a descendant wait', () => {
    const blockers = goalBlockers(goals, [{ goalId: 'D', dependsOnGoalId: 'B' }], 'D1');
    expect(blockers).toEqual([
      { goalId: 'B', viaGoalId: 'D' },
      { goalId: 'C', viaGoalId: 'D' },
    ]);
  });

  it('lists bundle members and holds a member for the unfinished rest', () => {
    expect(bundleMembers(goals, 'C')).toEqual(['B', 'C']);
    expect(bundleMembers(goals, 'A')).toEqual(['A']);
    expect(bundleHold(goals, 'B', (id) => id === 'B')).toEqual(['C']);
    expect(bundleHold(goals, 'B', () => true)).toEqual([]);
  });

  it('treats a blank bundle label as no bundle', () => {
    const blank: DependencyGoal[] = [
      { id: 'P', parentId: null, status: 'active' },
      { id: 'A', parentId: 'P', status: 'active', bundle: '  ' },
      { id: 'B', parentId: 'P', status: 'active', bundle: '' },
    ];
    expect(bundleMembers(blank, 'A')).toEqual(['A']);
    expect(validateGoalDependencies(blank, [{ goalId: 'B', dependsOnGoalId: 'A' }])).toEqual([]);
  });

  it('puts leftovers of corrupted cyclic data in one last wave instead of dropping them', () => {
    const waves = siblingWaves(
      goals,
      [
        { goalId: 'A', dependsOnGoalId: 'D' },
        { goalId: 'D', dependsOnGoalId: 'A' },
      ],
      'P'
    );
    expect(waves.flat().sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});

interface DeltaCase {
  name: string;
  before: { goals: DependencyGoal[]; edges: GoalDependencyEdge[] };
  after: { goals: DependencyGoal[]; edges: GoalDependencyEdge[] };
  errors: Array<{ goalId: string; dependsOnGoalId: string; code: string }>;
}

describe('goal dependencies — what a write may be rejected for', () => {
  const deltaCases = (fixtures as unknown as { deltaCases: DeltaCase[] }).deltaCases;
  it.each(deltaCases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const errors = introducedDependencyErrors(c.before, c.after).map((e) => ({
      goalId: e.goalId,
      dependsOnGoalId: e.dependsOnGoalId,
      code: e.code,
    }));
    expect(errors).toEqual(c.errors);
  });
});
