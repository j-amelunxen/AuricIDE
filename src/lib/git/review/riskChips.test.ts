import { describe, expect, it } from 'vitest';
import type { RiskFlag } from './riskFlags';
import { RISK_KIND_INFO, chipsFor, fileLevelFlags, flagsForHunk } from './riskChips';

const flags: RiskFlag[] = [
  { kind: 'lockfile', label: 'Lockfile' },
  { kind: 'type-escape', label: 'Type escape (any)', hunk: 0, line: 3, side: 'new' },
  { kind: 'type-escape', label: 'Type escape (any)', hunk: 0, line: 7, side: 'new' },
  { kind: 'unwrap', label: '.unwrap() can panic', hunk: 1, line: 20, side: 'new' },
];

describe('riskChips', () => {
  it('splits file-level flags from hunk flags', () => {
    expect(fileLevelFlags(flags).map((f) => f.kind)).toEqual(['lockfile']);
    expect(flagsForHunk(flags, 0)).toHaveLength(2);
    expect(flagsForHunk(flags, 1).map((f) => f.kind)).toEqual(['unwrap']);
    expect(flagsForHunk(flags, 2)).toEqual([]);
  });

  it('collapses repeated flags into one chip with a count, first-seen order', () => {
    const chips = chipsFor(flags);
    expect(chips.map((c) => [c.kind, c.count])).toEqual([
      ['lockfile', 1],
      ['type-escape', 2],
      ['unwrap', 1],
    ]);
  });

  it('marks only the higher-risk kinds amber', () => {
    const high = Object.entries(RISK_KIND_INFO)
      .filter(([, info]) => info.tone === 'high')
      .map(([kind]) => kind)
      .sort();
    expect(high).toEqual(['secret-like', 'test-removed', 'test-skipped', 'type-escape']);
  });

  it('explains every kind in one plain sentence', () => {
    for (const info of Object.values(RISK_KIND_INFO)) {
      expect(info.rule).toMatch(/^[A-Z].*\.$/);
      expect(info.rule).not.toContain('—');
    }
  });
});
