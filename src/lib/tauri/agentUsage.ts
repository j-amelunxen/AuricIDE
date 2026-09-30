import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export type UsageCostSource = 'cli' | 'estimated' | 'none';
export type UsageRunKind = 'ticket' | 'goal' | 'review' | 'other';

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
}

export interface AgentUsageRecorded {
  projectPath: string;
  row: AgentUsageRow;
}

/** Every recorded run of the project, newest first. */
export async function agentUsageLoad(projectPath: string): Promise<AgentUsageRow[]> {
  return await invoke<AgentUsageRow[]>('agent_usage_load', { projectPath });
}

/** Fires after Rust stored a run, so the open project can append without a reload. */
export function onAgentUsageRecorded(callback: (event: AgentUsageRecorded) => void): () => void {
  return subscribeToTauriEvent(
    'agent-usage-recorded',
    callback,
    '[Browser mode] Agent usage listener not available'
  );
}
