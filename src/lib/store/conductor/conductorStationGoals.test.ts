import { describe, expect, it } from 'vitest';
import type { GoalStatus, PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { getStationGoalWork, type StationGoalInput } from './conductorStationGoals';

// A stations goal with one open agent station: launchable unless its status
// says otherwise. Only the status varies between the cases.
function inputFor(status: GoalStatus): StationGoalInput {
  const goal = { id: 'g1', parentId: null, name: 'G', status, workMode: 'stations' } as PmGoal;
  const station = {
    id: 's1',
    goalId: 'g1',
    name: 'Work',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    lastCheckedAt: null,
  } as PmGoalStation;
  return {
    goals: [goal],
    tickets: [],
    stations: [station],
    goalId: 'g1',
    notifications: [],
    agents: [],
    projectPath: '/repo',
    attempts: {},
    judgeConfigured: false,
  };
}

describe('getStationGoalWork: goal status', () => {
  it('launches an agent for an open goal', () => {
    const work = getStationGoalWork(inputFor('in_progress'));
    expect(work.launchable.map((g) => g.id)).toEqual(['g1']);
  });

  // A goal in review waits for a verdict: the run keeps it in scope and in
  // flight, and must not start a second agent on work that is being judged.
  it('keeps a goal in review in flight, never launchable', () => {
    const work = getStationGoalWork(inputFor('in_review'));
    expect(work).toEqual({ inScope: ['g1'], launchable: [], inFlight: ['g1'], exhausted: [] });
  });

  it('leaves closed goals out of scope', () => {
    for (const status of ['achieved', 'failed', 'archived'] as const) {
      expect(getStationGoalWork(inputFor(status)).inScope).toEqual([]);
    }
  });
});
