import type { AgentInfo } from '../../tauri/agents';
import type { AgentEvent, AgentPhase } from './types';

/**
 * Where an agent stands right now, for a fleet-wide glance. Status owns the
 * terminal states (`failed`/`done`); everything else is read from the newest
 * structured event, with `waiting` checked first — a permission prompt is the
 * one state a running agent must never be mistaken for "just working".
 */
export function deriveAgentPhase(input: {
  status: AgentInfo['status'];
  awaitingInput?: boolean;
  lastEvent?: AgentEvent;
  hasOutput: boolean;
}): AgentPhase {
  if (input.status === 'error') return 'failed';
  if (input.status === 'idle') return 'done';
  if (input.status === 'queued' || !input.hasOutput) return 'starting';
  if (input.awaitingInput || input.lastEvent?.kind === 'ask') return 'waiting';

  switch (input.lastEvent?.kind) {
    case 'edit':
      return 'editing';
    case 'run':
      return 'running';
    case 'read':
      return 'reading';
    default:
      return 'planning';
  }
}
