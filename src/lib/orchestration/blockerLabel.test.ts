import { describe, expect, it } from 'vitest';
import type { PmGoal } from '../tauri/goals';
import { summarizeBlockers } from './blockerLabel';

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

describe('summarizeBlockers', () => {
  it('returns null with no blockers', () => {
    expect(summarizeBlockers([], [])).toBeNull();
  });

  it('names a single blocker by its own name', () => {
    const goals = [goal('A', { name: 'Backend' })];
    expect(summarizeBlockers(goals, [{ goalId: 'A', viaGoalId: 'B' }])).toBe('Backend');
  });

  it('names the first blocker plus a count for unrelated blockers', () => {
    const goals = [goal('A', { name: 'Backend' }), goal('B', { name: 'Design' })];
    const blockers = [
      { goalId: 'A', viaGoalId: 'C' },
      { goalId: 'B', viaGoalId: 'C' },
    ];
    expect(summarizeBlockers(goals, blockers)).toBe('Backend +1');
  });

  it('names the bundle when the blockers are exactly its members', () => {
    const goals = [
      goal('A', { name: 'Backend', bundle: 'api' }),
      goal('B', { name: 'Contracts', bundle: 'api' }),
    ];
    const blockers = [
      { goalId: 'A', viaGoalId: 'C' },
      { goalId: 'B', viaGoalId: 'C' },
    ];
    expect(summarizeBlockers(goals, blockers)).toBe('bundle api');
  });

  it('falls back to name-plus-count when only part of the bundle is still blocking', () => {
    const goals = [
      goal('A', { name: 'Backend', bundle: 'api', status: 'achieved' }),
      goal('B', { name: 'Contracts', bundle: 'api' }),
    ];
    // Only B is an actual blocker (A already achieved) — not the whole bundle.
    expect(summarizeBlockers(goals, [{ goalId: 'B', viaGoalId: 'C' }])).toBe('Contracts');
  });

  it('does not collapse a bundle name across different parents', () => {
    const goals = [
      goal('A', { name: 'Backend', parentId: 'P1', bundle: 'api' }),
      goal('B', { name: 'Contracts', parentId: 'P2', bundle: 'api' }),
    ];
    const blockers = [
      { goalId: 'A', viaGoalId: 'C' },
      { goalId: 'B', viaGoalId: 'C' },
    ];
    expect(summarizeBlockers(goals, blockers)).toBe('Backend +1');
  });
});
