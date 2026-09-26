import { describe, expect, it } from 'vitest';
import { decideGoalCompletion } from './goalCompletion';
import { resolveGoalWorkMode } from './workMode';

const stationsMode = resolveGoalWorkMode('auto', { hasTickets: false, hasStations: true });
const ticketsMode = resolveGoalWorkMode('auto', { hasTickets: true, hasStations: false });

describe('decideGoalCompletion', () => {
  it('lets a satisfied stations goal become achieved without any ticket', () => {
    const completion = decideGoalCompletion({
      satisfaction: { satisfied: true, blockers: [] },
      workMode: stationsMode,
      hasStations: true,
    });
    expect(completion).toEqual({ achievable: true, mode: 'stations', blockers: [] });
  });

  it('passes the satisfaction blockers through unchanged', () => {
    const completion = decideGoalCompletion({
      satisfaction: { satisfied: false, blockers: ['Station "Draft" is planned'] },
      workMode: stationsMode,
      hasStations: true,
    });
    expect(completion.achievable).toBe(false);
    expect(completion.blockers).toEqual(['Station "Draft" is planned']);
  });

  it('keeps ticket mode exactly as satisfaction decides', () => {
    expect(
      decideGoalCompletion({
        satisfaction: { satisfied: true, blockers: [] },
        workMode: ticketsMode,
        hasStations: false,
      }).achievable
    ).toBe(true);
  });

  it('refuses a goal set to stations mode that has no station to show for it', () => {
    const completion = decideGoalCompletion({
      satisfaction: { satisfied: true, blockers: [] },
      workMode: resolveGoalWorkMode('stations', { hasTickets: false, hasStations: false }),
      hasStations: false,
    });
    expect(completion.achievable).toBe(false);
    expect(completion.blockers).toEqual([
      'Stations mode: this goal has no stations yet. Plan its stations before it can be achieved.',
    ]);
  });
});
