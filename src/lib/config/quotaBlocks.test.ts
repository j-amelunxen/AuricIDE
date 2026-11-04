import { describe, expect, it } from 'vitest';
import {
  blockMatchesModel,
  findBlockForModel,
  formatScopeBadge,
  isBlockActive,
  isProviderFullyBlocked,
  type QuotaBlock,
} from './quotaBlocks';

const NOW = Date.parse('2026-10-23T18:00:00Z');

const agyClaudeBlock: QuotaBlock = {
  id: 'antigravity:family:claude-',
  provider: 'antigravity',
  scope: { kind: 'family', prefix: 'claude-' },
  reason: 'silent_model_fallback',
  detail: 'Fell back from claude-sonnet-5-5-high to Gemini 3.8 Flash (Medium)',
  detectedAt: '2026-10-23T17:55:00Z',
  expiresAt: '2026-10-23T19:00:00Z',
  sourceAgentId: 'agent-9',
};

const grokProviderBlock: QuotaBlock = {
  id: 'grok:provider',
  provider: 'grok',
  scope: { kind: 'provider' },
  reason: 'rate_limited',
  detail: 'Plan rate limit reached',
  detectedAt: '2026-10-23T17:30:00Z',
  expiresAt: '2026-10-23T18:30:00Z',
};

describe('quotaBlocks', () => {
  it('matches family, model, and provider scopes accurately', () => {
    expect(blockMatchesModel(agyClaudeBlock, 'antigravity', 'claude-sonnet-5-5-high')).toBe(true);
    expect(blockMatchesModel(agyClaudeBlock, 'antigravity', 'claude-opus-5-5-thinking')).toBe(true);
    expect(blockMatchesModel(agyClaudeBlock, 'antigravity', 'gemini-3.8-flash-medium')).toBe(false);
    expect(blockMatchesModel(agyClaudeBlock, 'claude', 'claude-sonnet-5-5-high')).toBe(false);

    expect(blockMatchesModel(grokProviderBlock, 'grok', 'grok-4-20')).toBe(true);
  });

  it('respects expiry timestamps', () => {
    expect(isBlockActive(agyClaudeBlock, NOW)).toBe(true);
    expect(isBlockActive(agyClaudeBlock, Date.parse('2026-10-23T19:00:00Z'))).toBe(false);
    expect(
      findBlockForModel(
        [agyClaudeBlock],
        'antigravity',
        'claude-sonnet-5-5-high',
        Date.parse('2026-10-23T19:01:00Z')
      )
    ).toBeNull();
  });

  it('determines when a provider has all allowed models blocked vs partial family block', () => {
    const blocks = [agyClaudeBlock, grokProviderBlock];
    // antigravity has both claude and gemini allowed -> NOT fully blocked
    expect(
      isProviderFullyBlocked(
        blocks,
        'antigravity',
        ['claude-sonnet-5-5-high', 'gemini-3.8-flash-medium'],
        NOW
      )
    ).toBe(false);

    // antigravity in a project that only allows claude models -> fully blocked
    expect(
      isProviderFullyBlocked(
        blocks,
        'antigravity',
        ['claude-sonnet-5-5-high', 'claude-opus-5-5-thinking'],
        NOW
      )
    ).toBe(true);

    // grok provider-wide block -> fully blocked
    expect(isProviderFullyBlocked(blocks, 'grok', ['grok-4-20'], NOW)).toBe(true);
  });

  it('formats human-readable scope badges', () => {
    expect(formatScopeBadge(agyClaudeBlock)).toBe('antigravity claude-*');
    expect(formatScopeBadge(grokProviderBlock)).toBe('grok (all models)');
  });
});
