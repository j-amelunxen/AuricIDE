import type { UsageRunKind } from '../../agents/types';

export type UsageCostSource = 'cli' | 'estimated' | 'reported' | 'none';

/** One finished agent run: what it consumed, and what it cost at list price. */
export interface AgentUsageRow {
  id: string;
  agentId: string;
  ticketId: string | null;
  goalId: string | null;
  runKind: UsageRunKind;
  runSource: string;
  provider: string;
  model: string | null;
  headless: boolean;
  sessionId: string | null;
  ticketStatusAtStart: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'killed';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** `null` = unknown (unpriced model or no usage source), never zero. */
  costUsd: number | null;
  costSource: UsageCostSource;
  matchKind: 'exact' | 'heuristic';
  estimateCostUsd: number | null;
  estimateInputTokens: number | null;
  estimateOutputTokens: number | null;
  estimateCacheReadTokens: number | null;
  estimateCacheWriteTokens: number | null;
  unpricedModels: string[] | null;
  numTurns: number | null;
  /** External runs only (`docs/design-external-agents.md`). Real runtime as reported; `null` = unknown. */
  activeMs: number | null;
  /** The time the IDE was told the run was working. */
  onMs: number | null;
  agentRuns: number | null;
  runtimePartial: boolean | null;
  externalId: string | null;
  externalRunId: string | null;
  /** `human` when closed by hand from the timeline. */
  closedBy: string | null;
}
