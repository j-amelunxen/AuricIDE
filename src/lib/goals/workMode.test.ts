import { describe, expect, it } from 'vitest';
import { resolveGoalWorkMode } from './workMode';

describe('resolveGoalWorkMode', () => {
  it('auto picks stations for a goal with stations and no tickets', () => {
    const resolved = resolveGoalWorkMode('auto', { hasTickets: false, hasStations: true });
    expect(resolved.mode).toBe('stations');
    expect(resolved.setting).toBe('auto');
    expect(resolved.reason).toMatch(/stations and no tickets/i);
  });

  it('auto keeps tickets as soon as the goal has tickets', () => {
    const resolved = resolveGoalWorkMode('auto', { hasTickets: true, hasStations: true });
    expect(resolved.mode).toBe('tickets');
    expect(resolved.reason).toMatch(/has tickets/i);
  });

  it('auto falls back to tickets while nothing is planned', () => {
    const resolved = resolveGoalWorkMode(undefined, { hasTickets: false, hasStations: false });
    expect(resolved.mode).toBe('tickets');
    expect(resolved.setting).toBe('auto');
    expect(resolved.reason).toMatch(/no stations/i);
  });

  it('an explicit setting wins over the shape of the goal', () => {
    expect(resolveGoalWorkMode('tickets', { hasTickets: false, hasStations: true }).mode).toBe(
      'tickets'
    );
    const stations = resolveGoalWorkMode('stations', { hasTickets: true, hasStations: true });
    expect(stations.mode).toBe('stations');
    expect(stations.setting).toBe('stations');
    expect(stations.reason).toMatch(/set on this goal/i);
  });

  it('reads an unknown stored value as auto instead of guessing', () => {
    const resolved = resolveGoalWorkMode('sideways', { hasTickets: false, hasStations: true });
    expect(resolved.setting).toBe('auto');
    expect(resolved.mode).toBe('stations');
  });
});
