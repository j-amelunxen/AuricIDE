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
export type AttentionReason = 'error' | 'needs-input' | 'stalled';

/** The slice of an agent the attention model reads. */
export type AttentionInput = Pick<AgentInfo, 'status' | 'lastActivityAt' | 'awaitingInput'>;

export function agentAttention(agent: AttentionInput, now: number): AttentionReason | null {
  if (agent.status === 'error') return 'error';
  if (agent.status !== 'running') return null;
  // Checked before the stall clock: a permission menu redraws itself, keeping
  // lastActivityAt fresh — a blocked agent that looks busy must still surface.
  if (agent.awaitingInput) return 'needs-input';
  // No recorded activity yet means the agent never spoke — its silence starts
  // at launch, and flagging that would cry wolf on every spawn.
  if (agent.lastActivityAt === undefined) return null;
  return now - agent.lastActivityAt >= AGENT_STALL_MS ? 'stalled' : null;
}

/** True when the agent has a reason to pull the user in. */
export function needsAttention(agent: AttentionInput, now: number): boolean {
  return agentAttention(agent, now) !== null;
}

/** How many agents in the fleet currently need a human. */
export function countNeedingAttention(agents: AttentionInput[], now: number): number {
  return agents.reduce((n, agent) => n + (needsAttention(agent, now) ? 1 : 0), 0);
}

/**
 * The next agent to check on, cycling through the ones that need a human in
 * fleet order. A calm or absent current selection starts the cycle at the
 * top; null when nobody needs anyone — the caller's shortcut stays inert.
 */
export function nextAttentionAgentId(
  agents: (AttentionInput & { id: string })[],
  currentId: string | null,
  now: number
): string | null {
  const needing = agents.filter((agent) => needsAttention(agent, now));
  if (needing.length === 0) return null;

  const currentIndex = needing.findIndex((agent) => agent.id === currentId);
  return needing[(currentIndex + 1) % needing.length].id;
}
