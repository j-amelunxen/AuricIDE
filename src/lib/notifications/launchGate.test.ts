import { describe, expect, it } from 'vitest';
import { decideLaunch, type LaunchGateInput } from './launchGate';

function input(overrides: Partial<LaunchGateInput> = {}): LaunchGateInput {
  return {
    grant: { maxConcurrent: 2, launchBudget: 3 },
    alreadyClaimed: false,
    used: 0,
    held: 0,
    ...overrides,
  };
}

describe('decideLaunch: positive', () => {
  it('starts with a grant in force, budget left and a free slot', () => {
    expect(decideLaunch(input())).toBe('start');
  });

  // Decision Jennifer 2026-09-26: requests that waited before the grant start
  // once it is given; limit and budget cap them. The gate has no clock.
  it('has no time rule: a request written before the grant starts like any other', () => {
    const early = { ...input(), requestCreatedAt: 0 } as LaunchGateInput;
    expect(decideLaunch(early)).toBe('start');
    expect(Object.keys(input())).not.toContain('requestCreatedAt');
  });

  it('starts the last budgeted launch into the last free slot', () => {
    expect(decideLaunch(input({ used: 2, held: 1 }))).toBe('start');
  });
});

describe('decideLaunch: negative (REQ-LAUNCH-01..03)', () => {
  it('does not start without a grant in force', () => {
    expect(decideLaunch(input({ grant: null }))).toBe('no-grant');
  });

  it('does not start a request someone already took', () => {
    expect(decideLaunch(input({ alreadyClaimed: true }))).toBe('already-claimed');
  });

  it('does not start once the budget is spent', () => {
    expect(decideLaunch(input({ used: 3 }))).toBe('budget-spent');
    expect(decideLaunch(input({ used: 7 }))).toBe('budget-spent');
  });

  it('does not start at the limit, counting unresolved starts as held', () => {
    expect(decideLaunch(input({ held: 2 }))).toBe('at-capacity');
    expect(decideLaunch(input({ held: 5 }))).toBe('at-capacity');
  });

  it('checks in a fixed order: grant, claim, budget, slot', () => {
    expect(decideLaunch(input({ grant: null, alreadyClaimed: true, used: 9, held: 9 }))).toBe(
      'no-grant'
    );
    expect(decideLaunch(input({ alreadyClaimed: true, used: 9, held: 9 }))).toBe('already-claimed');
    expect(decideLaunch(input({ used: 9, held: 9 }))).toBe('budget-spent');
  });
});

// Fault injection: numbers that are not numbers must close the gate, not open it.
describe('decideLaunch: fail closed on unreadable input', () => {
  it.each([
    ['unknown usage', { used: Number.NaN }, 'budget-spent'],
    ['infinite usage', { used: Number.POSITIVE_INFINITY }, 'budget-spent'],
    ['unknown slot count', { held: Number.NaN }, 'at-capacity'],
  ] as const)('%s', (_label, overrides, expected) => {
    expect(decideLaunch(input(overrides))).toBe(expected);
  });

  it('treats a grant with unreadable limits as spent or full', () => {
    expect(decideLaunch(input({ grant: { maxConcurrent: 2, launchBudget: Number.NaN } }))).toBe(
      'budget-spent'
    );
    expect(decideLaunch(input({ grant: { maxConcurrent: Number.NaN, launchBudget: 3 } }))).toBe(
      'at-capacity'
    );
  });
});
