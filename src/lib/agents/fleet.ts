import type { AgentInfo } from '../tauri/agents';

/** An agent that has stopped — either done or failed. It does no more work. */
export function isFinishedAgent(agent: Pick<AgentInfo, 'status'>): boolean {
  return agent.status === 'idle' || agent.status === 'error';
}

/**
 * Standing within the working list. Liveness is deliberately not part of it:
 * an agent that goes quiet for a moment must not jump around under the
 * cursor — a stale order is far cheaper than a moving one.
 */
const ACTIVE_RANK: Partial<Record<AgentInfo['status'], number>> = { running: 0, queued: 1 };

export interface FleetSplit {
  /** Agents still doing something, working ones first. */
  active: AgentInfo[];
  /** Stopped agents, most recently stopped first — a review list. */
  finished: AgentInfo[];
  /** Agents folded out of the way, in the order they were parked. */
  parked: AgentInfo[];
}

/**
 * Splits the fleet into the three things the panel draws differently: cards
 * for what is working, a compact list for what has stopped, and one line each
 * for what has been parked.
 */
export function splitFleet(agents: AgentInfo[], minimizedAgentIds: string[]): FleetSplit {
  const parkedIds = new Set(minimizedAgentIds);

  const active: AgentInfo[] = [];
  const finished: AgentInfo[] = [];
  for (const agent of agents) {
    if (parkedIds.has(agent.id)) continue;
    (isFinishedAgent(agent) ? finished : active).push(agent);
  }

  active.sort(
    (a, b) =>
      (ACTIVE_RANK[a.status] ?? 2) - (ACTIVE_RANK[b.status] ?? 2) || a.startedAt - b.startedAt
  );
  finished.sort((a, b) => b.startedAt - a.startedAt);

  // Ordered by the park list, not by the fleet — parking order is the order
  // the user set them aside in.
  const byId = new Map(agents.map((a) => [a.id, a]));
  const parked = minimizedAgentIds
    .map((id) => byId.get(id))
    .filter((a): a is AgentInfo => a !== undefined);

  return { active, finished, parked };
}
