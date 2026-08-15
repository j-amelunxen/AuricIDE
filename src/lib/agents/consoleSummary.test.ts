import { describe, it, expect } from 'vitest';
import { consoleSummaryLine, consoleAttentionBadge } from './consoleSummary';

describe('consoleSummaryLine', () => {
  it('pluralizes projects and "need" correctly', () => {
    expect(consoleSummaryLine({ running: 2, projects: 2, needing: 2, doneUnreviewed: 1 })).toBe(
      '2 running across 2 projects · 2 need you · 1 done, unreviewed'
    );
  });

  it('uses singular forms at one', () => {
    expect(consoleSummaryLine({ running: 1, projects: 1, needing: 1, doneUnreviewed: 1 })).toBe(
      '1 running across 1 project · 1 needs you · 1 done, unreviewed'
    );
  });

  it('reads zero across the board', () => {
    expect(consoleSummaryLine({ running: 0, projects: 0, needing: 0, doneUnreviewed: 0 })).toBe(
      '0 running across 0 projects · 0 need you · 0 done, unreviewed'
    );
  });
});

describe('consoleAttentionBadge', () => {
  it('reads "All clear" at zero', () => {
    expect(consoleAttentionBadge(0)).toBe('All clear');
  });

  it('reads singular at one', () => {
    expect(consoleAttentionBadge(1)).toBe('1 needs you');
  });

  it('reads plural above one', () => {
    expect(consoleAttentionBadge(3)).toBe('3 need you');
  });
});
