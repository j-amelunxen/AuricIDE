import type { AgentInfo } from '../tauri/agents';
import { agentAttention, sortByUrgency, withReviewFlags, type AttentionReason } from './attention';
import type { AgentEvent } from './events/types';

/**
 * One agent that should pop on the console's attention dock — the leftover
 * column to the right of the activity feed. Successes never appear here:
 * a clean finish stays in the feed, the same rule as the toast policy.
 */
export interface AttentionPop {
  agentId: string;
  agentName: string;
  repoPath?: string;
  reason: AttentionReason;
  headline: string;
}

export function selectAttentionPops({
  agents,
  reviewedAgentIds,
  agentEvents,
  now,
}: {
  agents: AgentInfo[];
  reviewedAgentIds: readonly string[];
  agentEvents: Record<string, AgentEvent[]>;
  now: number;
}): AttentionPop[] {
  const flagged = withReviewFlags(agents, reviewedAgentIds);
  return sortByUrgency(flagged, now).flatMap((agent) => {
    const reason = agentAttention(agent, now);
    if (!reason) return [];
    return [
      {
        agentId: agent.id,
        agentName: agent.name || agent.id,
        repoPath: agent.repoPath,
        reason,
        headline: headlineFor(reason, agentEvents[agent.id] ?? []),
      },
    ];
  });
}

function headlineFor(reason: AttentionReason, events: AgentEvent[]): string {
  const last = events.at(-1);
  switch (reason) {
    case 'needs-input': {
      const ask = lastAsk(events);
      return ask?.label ?? 'Waiting on you';
    }
    case 'error':
      return last?.label ?? 'Failed';
    case 'stalled':
      return last?.label ?? 'No output for a while';
  }
}

function lastAsk(events: AgentEvent[]): AgentEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'ask') return events[i];
  }
  return undefined;
}
