import type { AgentInfo } from '../tauri/agents';

/**
 * How long the store waits between two `lastActivityAt` bumps for the same
 * agent. Bumping on every streamed chunk would replace the agents array dozens
 * of times per second, so the timestamp is deliberately coarse.
 */
export const AGENT_ACTIVITY_BUMP_MS = 2_000;

/**
 * How long after its last recorded activity an agent still counts as live.
 *
 * This must stay comfortably wider than {@link AGENT_ACTIVITY_BUMP_MS} plus the
 * 1s UI tick: a busy agent's timestamp is stale by up to one bump interval by
 * design, so a window of the same width makes the Live badge and its pulsing
 * dot flip to Idle and back every couple of seconds while nothing has actually
 * changed.
 */
export const AGENT_LIVE_WINDOW_MS = 5_000;

/** True while the agent is running and has produced output recently. */
export function isAgentLive(agent: Pick<AgentInfo, 'status' | 'lastActivityAt'>, now: number) {
  if (agent.status !== 'running') return false;
  return agent.lastActivityAt !== undefined && now - agent.lastActivityAt < AGENT_LIVE_WINDOW_MS;
}

/** True while the agent is running but has gone quiet — waiting, thinking, or stuck. */
export function isAgentIdling(agent: Pick<AgentInfo, 'status' | 'lastActivityAt'>, now: number) {
  return agent.status === 'running' && !isAgentLive(agent, now);
}
