import type { AgentInfo } from '../tauri/agents';
import { isAgentLive } from './liveness';

/**
 * What an agent is doing, in the words the UI uses everywhere.
 *
 * This exists because the raw `status` field is ambiguous: `idle` there means
 * "the process has ended", while an agent that is running but has gone quiet
 * also reads as idle to a person. Two meanings, one word, and the card used to
 * show both at once. These five states each mean exactly one thing.
 */
export type AgentState = 'working' | 'waiting' | 'needs-input' | 'done' | 'error' | 'queued';

export function agentState(agent: AgentInfo, now: number): AgentState {
  switch (agent.status) {
    case 'running':
      // Before the liveness check: a redrawing permission menu keeps the
      // agent looking live while it is in fact blocked on the user.
      if (agent.awaitingInput) return 'needs-input';
      return isAgentLive(agent, now) ? 'working' : 'waiting';
    case 'idle':
      return 'done';
    case 'queued':
      return 'queued';
    default:
      return 'error';
  }
}

/** Human label for a state, as shown on cards and terminal tabs. */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  working: 'Working',
  waiting: 'Waiting',
  'needs-input': 'Needs input',
  done: 'Done',
  error: 'Failed',
  queued: 'Queued',
};
