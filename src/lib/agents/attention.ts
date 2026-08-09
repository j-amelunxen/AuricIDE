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
export type AttentionInput = Pick<AgentInfo, 'status' | 'lastActivityAt' | 'awaitingInput'> & {
  /**
   * True once the user opened this stopped agent's outcome. A reviewed
   * failure stops claiming attention: the acknowledgement is the review, and
   * an alarm that cannot be quitted is an alarm that gets ignored. Running
   * agents are never quieted this way — there is no outcome to review yet.
   */
  reviewed?: boolean;
};

export function agentAttention(agent: AttentionInput, now: number): AttentionReason | null {
  if (agent.status === 'error') return agent.reviewed ? null : 'error';
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

/** Most actionable first: a failure is final, a prompt is one keypress. */
const REASON_RANK: Record<AttentionReason, number> = { error: 0, 'needs-input': 1, stalled: 2 };

/** When this agent started waiting on the user — earlier means more urgent. */
function waitingSince(
  agent: AttentionInput & { startedAt?: number; finishedAt?: number },
  reason: AttentionReason
): number {
  switch (reason) {
    case 'error':
      return agent.finishedAt ?? agent.startedAt ?? 0;
    case 'stalled':
      return agent.lastActivityAt ?? 0;
    // A redrawing prompt keeps bumping lastActivityAt, so there is no honest
    // timestamp — equal keys keep the stable fleet order among themselves.
    case 'needs-input':
      return 0;
  }
}

/**
 * The attention set, most urgent first: failures before prompts before
 * stalls, and within a reason whoever has waited on the user longest. The
 * triage list must be trustable by position — otherwise the user reads every
 * row, which is the polling this panel exists to end.
 */
export function sortByUrgency<
  T extends AttentionInput & { id: string; startedAt?: number; finishedAt?: number },
>(agents: T[], now: number): T[] {
  return agents
    .map((agent) => ({ agent, reason: agentAttention(agent, now) }))
    .filter((x): x is { agent: T; reason: AttentionReason } => x.reason !== null)
    .sort(
      (a, b) =>
        REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
        waitingSince(a.agent, a.reason) - waitingSince(b.agent, b.reason)
    )
    .map((x) => x.agent);
}

/**
 * Stamps each agent with whether its outcome has been reviewed, so the
 * attention functions can be fed straight from the store's list + id set.
 */
export function withReviewFlags<T extends { id: string }>(
  agents: T[],
  reviewedAgentIds: readonly string[]
): (T & { reviewed: boolean })[] {
  return agents.map((agent) => ({ ...agent, reviewed: reviewedAgentIds.includes(agent.id) }));
}

/**
 * The next agent to check on, cycling through the ones that need a human in
 * fleet order. A calm or absent current selection starts the cycle at the
 * top; null when nobody needs anyone — the caller's shortcut stays inert.
 */
export function nextAttentionAgentId(
  agents: (AttentionInput & { id: string; startedAt?: number; finishedAt?: number })[],
  currentId: string | null,
  now: number
): string | null {
  // Same urgency order as the attention section, so the shortcut and the
  // list always agree on what "next" means.
  const needing = sortByUrgency(agents, now);
  if (needing.length === 0) return null;

  const currentIndex = needing.findIndex((agent) => agent.id === currentId);
  return needing[(currentIndex + 1) % needing.length].id;
}
