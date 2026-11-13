import type { AgentInfo } from './types';
import { agentAttention } from './attention';
import { AGENT_STATE_LABEL, agentStateLabel } from './state';

/**
 * The five buckets the Agent Console sorts and colours by. Coarser than
 * {@link import('./state').AgentState}: the console groups a project's agents
 * to read urgency at a glance, not to describe every nuance of "running" the
 * way a single agent's own card does.
 */
export type ConsoleAgentState = 'yours' | 'error' | 'stalled' | 'working' | 'queued' | 'done';

/**
 * Where an agent sits for the console's purposes: a failure or a finish are
 * final regardless of review state (review only softens the label), a
 * running agent is "yours" the moment it awaits input — checked before the
 * stall clock, since a redrawing permission prompt keeps `lastActivityAt`
 * fresh and would otherwise never look stalled.
 */
export function consoleAgentState(
  agent: Pick<AgentInfo, 'status' | 'lastActivityAt' | 'awaitingInput' | 'headless'> & {
    startedAt?: number;
  },
  reviewed: boolean,
  now: number
): ConsoleAgentState {
  if (agent.status === 'error') return 'error';
  if (agent.status === 'idle') return 'done';
  if (agent.status === 'queued') return 'queued';
  if (agent.awaitingInput) return 'yours';
  return agentAttention({ ...agent, reviewed }, now) === 'stalled' ? 'stalled' : 'working';
}

const BASE_LABEL: Record<ConsoleAgentState, string> = {
  yours: 'Waiting on you',
  error: 'Failed',
  stalled: 'Possibly stalled',
  working: 'Running',
  queued: AGENT_STATE_LABEL.queued,
  done: 'Done, unreviewed',
};

/**
 * The console's phase-chip text. Only "done" carries a review-aware second
 * form — a failure keeps reading "Failed" whether or not it was opened,
 * because reviewing does not undo that the run failed.
 */
export function consoleStateLabel(
  state: ConsoleAgentState,
  reviewed: boolean,
  headless?: boolean
): string {
  if (state === 'done' && reviewed) return 'Done';
  // A headless run escalates on length, not silence; the card says so too.
  if (state === 'stalled' && headless) return agentStateLabel('stalled', headless);
  return BASE_LABEL[state];
}

/** Most actionable first, for sorting agents inside a project section. */
export const CONSOLE_STATE_RANK: Record<ConsoleAgentState, number> = {
  yours: 0,
  error: 1,
  stalled: 2,
  working: 3,
  queued: 4,
  done: 5,
};
