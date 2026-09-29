import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalDependency, PmGoalStation } from '@/lib/tauri/goals';
import { ownGoalBlockers } from '../goals/goalSatisfaction';
import { describeSubtreeDependencyBlocks } from '../goals/goalDependencyAdapters';
import { summarizeRunBlockers } from './conductorRunBlockers';

let order = 0;
function goal(id: string, name: string, parentId: string | null = 'root'): PmGoal {
  order += 1;
  return {
    id,
    parentId,
    name,
    status: 'active',
    workMode: 'stations',
    sortOrder: order,
    createdAt: '',
  } as PmGoal;
}

function station(
  id: string,
  goalId: string,
  name: string,
  status: 'planned' | 'done',
  evidenceKind: 'claim' | 'proof' = 'proof'
): PmGoalStation {
  return {
    id,
    goalId,
    name,
    kind: 'normal',
    status,
    evidenceKind,
    predicate: { type: 'undefined' },
    lastCheckedAt: null,
  } as PmGoalStation;
}

function edge(goalId: string, dependsOnGoalId: string): PmGoalDependency {
  return { id: `${goalId}->${dependsOnGoalId}`, goalId, dependsOnGoalId, createdAt: '' };
}

// A parent with a serial line of ranks: rank 2 and rank 3 wait for rank 1.
// Every rank has the same two stations, as a generated mission does.
function serialLine() {
  const goals = [
    goal('root', 'Onboarding', null),
    goal('r1', 'Rank 1'),
    goal('r2', 'Rank 2'),
    goal('r3', 'Rank 3'),
  ];
  const stations = [
    station('s1a', 'r1', 'Recon', 'done'),
    station('s1b', 'r1', 'Review passed', 'planned', 'claim'),
    station('s2a', 'r2', 'Recon', 'planned'),
    station('s2b', 'r2', 'Review passed', 'planned', 'claim'),
    station('s3a', 'r3', 'Recon', 'planned'),
    station('s3b', 'r3', 'Review passed', 'planned', 'claim'),
  ];
  const deps = [edge('r2', 'r1'), edge('r3', 'r1')];
  // The blockers exactly as the tick builds them today.
  const blockers = [
    ...ownGoalBlockers(goals, [], [], [], stations, 'root'),
    ...describeSubtreeDependencyBlocks(goals, deps, 'root'),
  ];
  return { goals, stations, deps, blockers };
}

describe('summarizeRunBlockers', () => {
  it('leads with the goal that ran out of attempts and names its open stations', () => {
    const { goals, stations, deps, blockers } = serialLine();
    const lines = summarizeRunBlockers({
      blockers,
      goals,
      stations,
      goalDependencies: deps,
      rootId: 'root',
      exhausted: [{ goalId: 'r1', purpose: 'work', attempts: 2 }],
    });
    expect(lines[0]).toBe(
      'Goal "Rank 1" is out of attempts: its agent ran 2 times and left 1 station open ' +
        '("Review passed"). Starting the run again gives it fresh attempts.'
    );
  });

  it('folds everything a waiting goal holds into one line per blocker', () => {
    const { goals, stations, deps, blockers } = serialLine();
    const lines = summarizeRunBlockers({
      blockers,
      goals,
      stations,
      goalDependencies: deps,
      rootId: 'root',
      exhausted: [],
    });
    expect(lines).toEqual([
      'Station "Review passed" is planned',
      'Sub-goal "Rank 1" is active, not achieved',
      '2 goals wait for Rank 1',
    ]);
  });

  it('keeps a single waiting goal as its own line', () => {
    const { goals, stations } = serialLine();
    const deps = [edge('r2', 'r1')];
    const lines = summarizeRunBlockers({
      blockers: [
        ...ownGoalBlockers(goals, [], [], [], stations, 'root'),
        ...describeSubtreeDependencyBlocks(goals, deps, 'root'),
      ],
      goals,
      stations,
      goalDependencies: deps,
      rootId: 'root',
      exhausted: [],
    });
    expect(lines).toContain('Goal "Rank 2" waits for Rank 1');
    // Rank 3 is not held, so its own stations still count as open work.
    expect(lines.filter((l) => l === 'Station "Recon" is planned')).toHaveLength(1);
    expect(lines).toContain('Sub-goal "Rank 3" is active, not achieved');
  });

  it('describes a planning agent that ran out without laying out work', () => {
    const goals = [goal('root', 'Onboarding', null), goal('r1', 'Rank 1')];
    const lines = summarizeRunBlockers({
      blockers: ownGoalBlockers(goals, [], [], [], [], 'root'),
      goals,
      stations: [],
      goalDependencies: [],
      rootId: 'root',
      exhausted: [{ goalId: 'r1', purpose: 'plan', attempts: 2 }],
    });
    expect(lines[0]).toBe(
      'Goal "Rank 1" is out of attempts: its planning agent ran 2 times and laid out no work. ' +
        'Starting the run again gives it fresh attempts.'
    );
  });

  it('leaves blockers alone when nothing waits and nothing ran out', () => {
    const blockers = ['Ticket "Ship it" is open', 'Requirement REQ-1 is active, not verified'];
    expect(
      summarizeRunBlockers({
        blockers,
        goals: [goal('root', 'Onboarding', null)],
        stations: [],
        goalDependencies: [],
        rootId: 'root',
        exhausted: [],
      })
    ).toEqual(blockers);
  });
});
