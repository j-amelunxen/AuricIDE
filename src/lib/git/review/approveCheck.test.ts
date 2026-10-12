import { describe, expect, it } from 'vitest';
import {
  AGENT_RUNNING_REASON,
  approveDecision,
  approvePendingReason,
  changedFileCount,
} from './approveCheck';

const all = { viewed: 3, changed: 0, total: 3 };
const pending = { viewed: 1, changed: 1, total: 3 };

describe('approveCheck', () => {
  it('spells out what is still waiting', () => {
    expect(approvePendingReason(all)).toBeNull();
    expect(approvePendingReason(pending)).toBe(
      '1 file not viewed yet, 1 changed since you viewed it'
    );
  });

  it('counts added, removed and changed files between two readings', () => {
    const before = [
      { path: 'a', hash: '1' },
      { path: 'b', hash: '1' },
    ];
    expect(changedFileCount(before, before)).toBe(0);
    expect(
      changedFileCount(before, [
        { path: 'a', hash: '2' },
        { path: 'c', hash: '1' },
      ])
    ).toBe(3);
  });

  it('goes when everything is viewed and nothing runs', () => {
    expect(approveDecision({ progress: all, occupied: false, changed: 0, anyway: false })).toEqual({
      kind: 'go',
    });
  });

  it('refuses while an agent runs there, even for Approve anyway', () => {
    for (const anyway of [false, true]) {
      expect(approveDecision({ progress: all, occupied: true, changed: 0, anyway })).toEqual({
        kind: 'refuse',
        reason: AGENT_RUNNING_REASON,
      });
    }
  });

  it('refuses a plain Approve that the re-read turned into an unreviewed one, and says why', () => {
    const decision = approveDecision({
      progress: pending,
      occupied: false,
      changed: 1,
      anyway: false,
    });
    expect(decision).toEqual({
      kind: 'refuse',
      reason:
        'The changes moved on while you reviewed. Approve waits: 1 file not viewed yet, 1 changed since you viewed it.',
    });
  });

  it('asks again before Approve anyway when the re-read changed anything', () => {
    expect(
      approveDecision({ progress: pending, occupied: false, changed: 2, anyway: true })
    ).toMatchObject({
      kind: 'confirm',
      message: expect.stringContaining('2 files have changed since you last looked'),
    });
    expect(
      approveDecision({ progress: pending, occupied: false, changed: 0, anyway: true })
    ).toEqual({
      kind: 'go',
    });
  });

  it('refuses an empty change set', () => {
    expect(
      approveDecision({
        progress: { viewed: 0, changed: 0, total: 0 },
        occupied: false,
        changed: 0,
        anyway: true,
      })
    ).toMatchObject({ kind: 'refuse' });
  });
});
