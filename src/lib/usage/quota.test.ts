import { describe, expect, it } from 'vitest';

import claudeNormalized from '../../../fixtures/usage-limits/claude.statusline.normalized.json';
import codexMultiNormalized from '../../../fixtures/usage-limits/codex.rate-limits.multi-limit.normalized.json';
import codexNormalized from '../../../fixtures/usage-limits/codex.rate-limits.normalized.json';
import {
  ageMs,
  chipGroups,
  compactWindowLabel,
  formatPercent,
  msUntilReset,
  overallTone,
  providerName,
  providerTag,
  quotaTone,
  worstWindow,
} from './quota';
import type { UsageSnapshot } from './types';

/**
 * The golden fixtures are the contract with the Rust side: it asserts it
 * produces these, this file asserts we can render them. Reading them here
 * rather than hand-building objects is the point — a shape change on the other
 * side has to break something on this one.
 */
const CLAUDE = claudeNormalized as UsageSnapshot;
const CODEX = codexNormalized as UsageSnapshot;
const CODEX_MULTI = codexMultiNormalized as UsageSnapshot;

function snapshot(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  return { ...CODEX, windows: [], credits: null, ...overrides };
}

describe('the shared normalized shape', () => {
  it('is what the Rust side says it produces', () => {
    // If these stop lining up, the two sides have drifted and the fixtures are
    // the place to fix it first.
    expect(CODEX.provider).toBe('codex');
    expect(CODEX.source).toBe('app-server');
    expect(CODEX.windows).toHaveLength(1);
    expect(CODEX.windows[0].kind).toBe('7d');
    expect(CODEX.windows[0].windowMinutes).toBe(10080);

    expect(CLAUDE.provider).toBe('claude');
    expect(CLAUDE.source).toBe('statusline');
    expect(CLAUDE.windows.map((w) => w.kind)).toEqual(['5h', '7d']);
  });

  it('keeps the credit balance as text', () => {
    // Parsing it to a number would drop digits the server deliberately sent.
    expect(CODEX.credits?.balance).toBe('21979.6827500000');
  });
});

describe('worstWindow', () => {
  it('leads with the window closest to running out', () => {
    expect(worstWindow([CLAUDE, CODEX])?.usedPercent).toBe(41.2);
  });

  it('looks across every limit id, not just the first', () => {
    expect(worstWindow([CODEX_MULTI])?.limitId).toBe('codex');
  });

  it('treats a reading with no windows as no statement at all', () => {
    // The failure this guards against: rendering "0 %" — plenty of quota! —
    // for an account that reported nothing.
    expect(worstWindow([snapshot({ windows: [] })])).toBeNull();
    expect(overallTone([snapshot({ windows: [] })])).toBe('calm');
  });

  it('is null when there is nothing to read', () => {
    expect(worstWindow([])).toBeNull();
  });
});

describe('quotaTone', () => {
  it('stays quiet well below the limit', () => {
    expect(quotaTone(0)).toBe('calm');
    expect(quotaTone(59.9)).toBe('calm');
  });

  it('warns from 60 and escalates from 85', () => {
    expect(quotaTone(60)).toBe('warn');
    expect(quotaTone(84.9)).toBe('warn');
    expect(quotaTone(85)).toBe('critical');
    expect(quotaTone(100)).toBe('critical');
  });

  it('takes the tone from the worst window across providers', () => {
    const hot = snapshot({
      provider: 'claude',
      windows: [{ ...CLAUDE.windows[0], usedPercent: 92 }],
    });
    expect(overallTone([CODEX, hot])).toBe('critical');
  });
});

describe('chipGroups', () => {
  it('shows every window a provider reported, not just the worst one', () => {
    // The 5-hour session and the weekly budget run out for different reasons.
    // Collapsing them to one number hides whichever happens to be lower, and
    // that is usually the week — the one you cannot wait out.
    const groups = chipGroups([CLAUDE, CODEX]);
    expect(groups.map((g) => g.tag)).toEqual(['CC', 'CX']);
    expect(groups[0].windows.map((w) => w.label)).toEqual(['5h', '7d']);
    expect(groups[0].windows.map((w) => w.usedPercent)).toEqual([23.5, 41.2]);
    expect(groups[1].windows.map((w) => w.label)).toEqual(['7d']);
  });

  it('tones each window on its own', () => {
    // One calm window next to a critical one must not paint both the same, in
    // either direction: the quiet 5 h would hide a spent week, and the spent
    // week would make the 5 h look like it needs attention it does not.
    const groups = chipGroups([
      snapshot({
        provider: 'claude',
        windows: [
          { ...CLAUDE.windows[0], usedPercent: 4 },
          { ...CLAUDE.windows[1], usedPercent: 91 },
        ],
      }),
    ]);
    expect(groups[0].windows.map((w) => w.tone)).toEqual(['calm', 'critical']);
  });

  it('leaves out a provider that reported nothing', () => {
    const groups = chipGroups([CODEX, snapshot({ provider: 'claude', windows: [] })]);
    expect(groups.map((g) => g.provider)).toEqual(['codex']);
  });

  it('falls back to a readable tag for an unknown provider', () => {
    expect(providerTag('gemini')).toBe('GE');
    expect(providerName('gemini')).toBe('gemini');
    expect(providerName('claude')).toBe('Claude Code');
  });
});

describe('compactWindowLabel', () => {
  it('drops the space the popover can afford and the chip cannot', () => {
    expect(compactWindowLabel('5 h')).toBe('5h');
    expect(compactWindowLabel('7 d')).toBe('7d');
    expect(compactWindowLabel('90 min')).toBe('90min');
  });
});

describe('formatting', () => {
  it('rounds percentages rather than showing false precision', () => {
    expect(formatPercent(41.2)).toBe('41%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(99.6)).toBe('100%');
  });

  it('never counts down past zero', () => {
    const resetsAt = 1_000;
    expect(msUntilReset(resetsAt, 500_000)).toBe(500_000);
    expect(msUntilReset(resetsAt, 2_000_000)).toBe(0);
  });

  it('never reports a reading as coming from the future', () => {
    expect(ageMs(1_000, 1_500_000)).toBe(500_000);
    expect(ageMs(1_000, 500_000)).toBe(0);
  });
});
