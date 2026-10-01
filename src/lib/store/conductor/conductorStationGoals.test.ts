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
    expect(work).toEqual({
      inScope: ['g1'],
      launchable: [],
      inFlight: ['g1'],
      exhausted: [],
      blocked: [],
    });
  });

  it('leaves closed goals out of scope', () => {
    for (const status of ['achieved', 'failed', 'archived'] as const) {
      expect(getStationGoalWork(inputFor(status)).inScope).toEqual([]);
    }
  });
});

describe('getStationGoalWork: dependency gate', () => {
  it('holds a stations goal blocked by an unfinished dependency out of launchable', () => {
    const input = inputFor('in_progress');
    const blocker = { id: 'g0', parentId: null, name: 'G0', status: 'active' } as PmGoal;
    const input2: StationGoalInput = {
      ...input,
      goals: [blocker, ...input.goals],
      goalDependencies: [
        { id: 'e1', goalId: 'g1', dependsOnGoalId: 'g0', createdAt: '2026-01-01 00:00:00' },
      ],
    };
    const work = getStationGoalWork(input2);
    expect(work).toEqual({
      inScope: ['g1'],
      launchable: [],
      inFlight: [],
      exhausted: [],
      blocked: ['g1'],
    });
  });

  it('launches once the dependency releases', () => {
    const input = inputFor('in_progress');
    const blocker = { id: 'g0', parentId: null, name: 'G0', status: 'achieved' } as PmGoal;
    const input2: StationGoalInput = {
      ...input,
      goals: [blocker, ...input.goals],
      goalDependencies: [
        { id: 'e1', goalId: 'g1', dependsOnGoalId: 'g0', createdAt: '2026-01-01 00:00:00' },
      ],
    };
    expect(getStationGoalWork(input2).launchable.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('getStationGoalWork: rejected claims', () => {
  function withStation(station: Partial<PmGoalStation>): StationGoalInput {
    const input = inputFor('in_progress');
    return { ...input, stations: [{ ...input.stations[0], ...station }] };
  }

  // A judge's rejection leaves the step done + claim with lastCheckedAt set.
  // That is open work: an agent has to fix the work or the evidence.
  it('treats a claim the judge rejected as open agent work', () => {
    const work = getStationGoalWork(
      withStation({
        status: 'done',
        evidenceKind: 'claim',
        evidenceNote: 'rejected: evidence does not cover the step',
        lastCheckedAt: '2026-09-30 21:36:12',
      })
    );
    expect(work.launchable.map((g) => g.id)).toEqual(['g1']);
  });

  it('leaves a step the judge passed alone', () => {
    const work = getStationGoalWork(
      withStation({
        status: 'done',
        evidenceKind: 'judged',
        lastCheckedAt: '2026-09-30 21:36:12',
      })
    );
    expect(work.launchable).toEqual([]);
  });
});
