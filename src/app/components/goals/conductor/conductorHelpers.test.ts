import { describe, expect, it } from 'vitest';
import type { ConductorPreflight } from '@/lib/store/conductorSlice';
import { preflightLabel } from './conductorHelpers';

const EMPTY: ConductorPreflight = {
  total: 0,
  done: 0,
  ready: 0,
  blocked: 0,
  needsApproval: 0,
  inProgress: 0,
  inReview: 0,
  toTest: 0,
  exhausted: 0,
  stationGoals: 0,
  stationGoalsReady: 0,
};

describe('preflightLabel', () => {
  it('asks for work when the goal has neither tickets nor stations', () => {
    expect(preflightLabel(EMPTY, 'Guide')).toBe('No tickets yet - create work first');
  });

  it('names the stations goals a run would start agents for', () => {
    expect(preflightLabel({ ...EMPTY, stationGoals: 1, stationGoalsReady: 1 }, 'Guide')).toBe(
      '1 stations goal ready for a goal agent'
    );
    expect(
      preflightLabel({ ...EMPTY, stationGoals: 2, stationGoalsReady: 2, ready: 1 }, 'Guide')
    ).toBe('1 ready · 2 stations goals ready for a goal agent');
  });

  it('says a run would check a stations goal that has no agent work left', () => {
    expect(preflightLabel({ ...EMPTY, stationGoals: 1 }, 'Guide')).toBe(
      'No agent work left - a run checks whether the goal is achieved'
    );
  });
});
