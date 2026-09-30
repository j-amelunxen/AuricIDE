import type { AgentUsageRow } from '@/lib/tauri/agentUsage';

let counter = 0;

/** A finished, fully priced run; override only what the test is about. */
export function usageRow(overrides: Partial<AgentUsageRow> = {}): AgentUsageRow {
  counter += 1;
  return {
    id: `run-${counter}`,
    agentId: `agent-${counter}`,
    ticketId: null,
    goalId: null,
    runKind: 'ticket',
    runSource: 'conductor',
    provider: 'claude',
    model: 'model-a',
    headless: true,
    sessionId: null,
    ticketStatusAtStart: null,
    startedAt: '2026-09-29T10:00:00Z',
    finishedAt: '2026-09-29T10:01:00Z',
    durationMs: 60_000,
    outcome: 'success',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    costSource: 'cli',
    matchKind: 'exact',
    estimateCostUsd: null,
    estimateInputTokens: null,
    estimateOutputTokens: null,
    estimateCacheReadTokens: null,
    estimateCacheWriteTokens: null,
    unpricedModels: null,
    numTurns: null,
    ...overrides,
  };
}
