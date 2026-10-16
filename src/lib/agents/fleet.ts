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
  // By when they stopped, not when they started: the review list reads
  // newest-outcome-first, and a long runner that just failed is fresh news.
  finished.sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));

  // Ordered by the park list, not by the fleet — parking order is the order
  // the user set them aside in.
  const byId = new Map(agents.map((a) => [a.id, a]));
  const parked = minimizedAgentIds
    .map((id) => byId.get(id))
    .filter((a): a is AgentInfo => a !== undefined);

  return { active: underSupervisors(active), finished: underSupervisors(finished), parked };
}

/**
 * Moves each supervisor's children directly beneath it, keeping the list's
 * own order everywhere else. Only within one list: a child whose supervisor
 * sits in another shape (stopped, parked) stays where its own state put it,
 * so the move never changes what a shape holds — only where a row sits.
 */
function underSupervisors(list: AgentInfo[]): AgentInfo[] {
  const present = new Set(list.map((a) => a.id));
  const children = new Map<string, AgentInfo[]>();
  for (const agent of list) {
    const parent = agent.spawnedByAgentId;
    if (!parent || !present.has(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  if (children.size === 0) return list;
  return list
    .filter((agent) => !agent.spawnedByAgentId || !present.has(agent.spawnedByAgentId))
    .flatMap((agent) => [agent, ...(children.get(agent.id) ?? [])]);
}

/**
 * "2 children · 1 running" for a supervisor's card. A string on purpose: it is
 * what a store selector returns, and a primitive keeps that selector stable.
 */
export function supervisorChildSummary(agents: AgentInfo[], supervisorId: string): string {
  let total = 0;
  let running = 0;
  for (const agent of agents) {
    if (agent.spawnedByAgentId !== supervisorId) continue;
    total += 1;
    if (agent.status === 'running') running += 1;
  }
  if (total === 0) return 'No children yet';
  return `${total} ${total === 1 ? 'child' : 'children'} · ${running} running`;
}
