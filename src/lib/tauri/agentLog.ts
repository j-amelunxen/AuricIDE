import { invoke } from './invoke';

/**
 * One entry of the Agent Console's activity feed as it is stored on disk.
 *
 * `seq` orders events written within the same millisecond, which `at` alone
 * cannot: a busy fleet produces several events per tick.
 */
export interface PersistedAgentEvent {
  agentId: string;
  agentName: string;
  repoPath?: string;
  kind: string;
  label: string;
  path?: string;
  at: number;
  seq: number;
}

/** Appends a batch of events. Batched because the feed writes in bursts. */
export async function agentLogAppend(events: PersistedAgentEvent[]): Promise<void> {
  return await invoke<void>('agent_log_append', { events });
}

/** Reads back the newest stored events, at most `limit` of them. */
export async function agentLogLoad(limit: number): Promise<PersistedAgentEvent[]> {
  return await invoke<PersistedAgentEvent[]>('agent_log_load', { limit });
}

/**
 * Trims the stored history to both bounds and answers how many rows went.
 * A `retentionDays` of `0` drops the age bound; `maxRows` always applies.
 */
export async function agentLogPrune(retentionDays: number, maxRows: number): Promise<number> {
  return await invoke<number>('agent_log_prune', { retentionDays, maxRows });
}

/** Deletes the stored history outright. Irreversible — ask before calling. */
export async function agentLogPurge(): Promise<void> {
  return await invoke<void>('agent_log_purge');
}
