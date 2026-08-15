import type { AgentInfo } from '../../tauri/agents';
import type { AgentEvent } from './types';

export interface FeedEntry extends AgentEvent {
  agentId: string;
}

/**
 * Every tracked agent's events interleaved into one feed, newest first. Two
 * events commonly share the same `at` (one PTY chunk, several matches) — for
 * those, `seq` (monotonic per agent) breaks the tie so the later of the two
 * still sorts above the earlier one. Once both `at` and `seq` tie (only
 * possible across two different agents), the order agents appear in `agents`
 * decides it — `Array.prototype.sort` is a stable sort, so that ordering
 * falls out of build order rather than needing a further tiebreaker.
 */
export function mergeActivityFeed(
  agentEvents: Record<string, AgentEvent[]>,
  agents: AgentInfo[],
  limit = 200
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const agent of agents) {
    for (const event of agentEvents[agent.id] ?? []) {
      entries.push({ ...event, agentId: agent.id });
    }
  }
  return entries.sort((a, b) => b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0)).slice(0, limit);
}
