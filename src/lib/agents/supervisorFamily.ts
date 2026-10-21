import type { AgentInfo } from '../tauri/agents';

/**
 * Which supervisor's family each agent belongs to: walk `spawnedByAgentId` up
 * while the parent is still listed, and if the walk ends at a supervisor, that
 * one is the family. A supervisor started by another one belongs to the top
 * one. Agents whose walk ends anywhere else — a plain agent, a child whose
 * supervisor was cleared from the list — get no entry.
 *
 * Tab grouping and family colours both read this, so a tab cannot sit in one
 * family and wear another's colour.
 */
export function supervisorFamilyRoots(agents: readonly AgentInfo[]): Map<string, string> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const roots = new Map<string, string>();
  for (const agent of agents) {
    let top = agent;
    const seen = new Set([agent.id]);
    for (;;) {
      const parentId = top.spawnedByAgentId;
      const parent = parentId ? byId.get(parentId) : undefined;
      // A loop in the chain is bad data, not a family; stop where it closes.
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      top = parent;
    }
    if (top.role === 'supervisor') roots.set(agent.id, top.id);
  }
  return roots;
}

/**
 * A resumed supervisor takes over the children of the earlier supervisors of
 * its run folder (`fromIds`, decided by Rust and sent with
 * `supervisor-children-adopted`). Only `spawnedByAgentId` moves; the same list
 * comes back when nobody changes, so a store write can be skipped.
 */
export function adoptSupervisorChildren(
  agents: AgentInfo[],
  toId: string,
  fromIds: readonly string[]
): AgentInfo[] {
  const from = new Set(fromIds);
  if (!agents.some((agent) => agent.spawnedByAgentId && from.has(agent.spawnedByAgentId))) {
    return agents;
  }
  return agents.map((agent) =>
    agent.spawnedByAgentId && from.has(agent.spawnedByAgentId)
      ? { ...agent, spawnedByAgentId: toId }
      : agent
  );
}
