import type { AgentInfo } from '../tauri/agents';

/**
 * How long an agent may stay silent before its silence becomes the user's
 * problem. Far wider than the live window on purpose: between "live" and
 * "stalled" lies ordinary waiting — thinking, long tool calls, a slow build —
 * and alarming on that would train the user to ignore the alarm.
 */
export const AGENT_STALL_MS = 120_000;

/**
 * Why an agent needs a human right now, or null while it doesn't.
 *
 * This is the panel's single definition of "needs attention": the system
 * decides when to interrupt the user, so the user does not have to keep
 * polling every card to find out. Watching is the machine's job here —
 * anything running normally, queued, or cleanly done asks for nothing.
 */
export type AttentionReason = 'error' | 'stalled';

export function agentAttention(
  agent: Pick<AgentInfo, 'status' | 'lastActivityAt'>,
  now: number
): AttentionReason | null {
  if (agent.status === 'error') return 'error';
  if (agent.status !== 'running') return null;
  // No recorded activity yet means the agent never spoke — its silence starts
  // at launch, and flagging that would cry wolf on every spawn.
  if (agent.lastActivityAt === undefined) return null;
  return now - agent.lastActivityAt >= AGENT_STALL_MS ? 'stalled' : null;
}

/** True when the agent has a reason to pull the user in. */
export function needsAttention(
  agent: Pick<AgentInfo, 'status' | 'lastActivityAt'>,
  now: number
): boolean {
  return agentAttention(agent, now) !== null;
}

/** How many agents in the fleet currently need a human. */
export function countNeedingAttention(
  agents: Pick<AgentInfo, 'status' | 'lastActivityAt'>[],
  now: number
): number {
  return agents.reduce((n, agent) => n + (needsAttention(agent, now) ? 1 : 0), 0);
}
