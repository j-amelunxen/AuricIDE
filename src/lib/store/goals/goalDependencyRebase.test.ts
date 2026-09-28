import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalDependency } from '../../tauri/goals';
import { dropIntroducedDependencyDrafts } from './goalDependencyRebase';

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

function edge(id: string, goalId: string, dependsOnGoalId: string): PmGoalDependency {
  return { id, goalId, dependsOnGoalId, createdAt: '2026-01-01 00:00:00' };
}

describe('dropIntroducedDependencyDrafts', () => {
  it('leaves a clean draft untouched', () => {
    const goals = [goal({ id: 'A' }), goal({ id: 'B' })];
    const edges = [edge('e1', 'B', 'A')];
    const result = dropIntroducedDependencyDrafts({ goals, edges }, { goals, edges });
    expect(result).toEqual({ goals, edges, droppedEdgeIds: [], resetBundleGoalIds: [] });
  });

  it('drops the local edge that, together with a concurrent MCP edge, would cycle', () => {
    // The QA scenario: the UI drafted B -> A locally; MCP has since written
    // A -> B straight to the database. Saving both would cycle forever.
    const goals = [goal({ id: 'A' }), goal({ id: 'B' })];
    const fresh = { goals, edges: [edge('mcp-1', 'A', 'B')] };
    const draft = { goals, edges: [edge('mcp-1', 'A', 'B'), edge('local-1', 'B', 'A')] };
    const result = dropIntroducedDependencyDrafts(fresh, draft);
    expect(result.edges).toEqual([edge('mcp-1', 'A', 'B')]);
    expect(result.droppedEdgeIds).toEqual(['local-1']);
    expect(result.resetBundleGoalIds).toEqual([]);
  });

  it('resets a local bundle edit that turns a fresh edge into a same-bundle violation', () => {
    // Fresh already has B -> A and B bundled "x". The draft locally bundled A
    // into "x" too, which would put both ends of that edge in one bundle.
    const fresh = {
      goals: [goal({ id: 'A' }), goal({ id: 'B', bundle: 'x' })],
      edges: [edge('e1', 'B', 'A')],
    };
    const draftGoals = [goal({ id: 'A', bundle: 'x' }), goal({ id: 'B', bundle: 'x' })];
    const result = dropIntroducedDependencyDrafts(fresh, { goals: draftGoals, edges: fresh.edges });
    expect(result.goals.find((g) => g.id === 'A')?.bundle).toBeNull();
    expect(result.resetBundleGoalIds).toEqual(['A']);
    expect(result.droppedEdgeIds).toEqual([]);
  });

  it('leaves a pre-existing problem in the fresh state alone rather than looping', () => {
    // Fresh itself already has a cyclic pair (e.g. written by an older build).
    // The draft did not add anything new, so nothing should be touched.
    const goals = [goal({ id: 'A' }), goal({ id: 'B' })];
    const cyclicEdges = [edge('e1', 'B', 'A'), edge('e2', 'A', 'B')];
    const fresh = { goals, edges: cyclicEdges };
    const result = dropIntroducedDependencyDrafts(fresh, { goals, edges: cyclicEdges });
    expect(result).toEqual({
      goals,
      edges: cyclicEdges,
      droppedEdgeIds: [],
      resetBundleGoalIds: [],
    });
  });

  it('drops only the edges it must, keeping other local additions', () => {
    const goals = [goal({ id: 'A' }), goal({ id: 'B' }), goal({ id: 'C' })];
    const fresh = { goals, edges: [edge('mcp-1', 'A', 'B')] };
    const draft = {
      goals,
      edges: [edge('mcp-1', 'A', 'B'), edge('local-1', 'B', 'A'), edge('local-2', 'C', 'A')],
    };
    const result = dropIntroducedDependencyDrafts(fresh, draft);
    expect(result.edges.map((e) => e.id).sort()).toEqual(['local-2', 'mcp-1']);
    expect(result.droppedEdgeIds).toEqual(['local-1']);
  });
});
