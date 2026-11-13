import type { AgentWaiting } from '../agents/types';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export const AGENT_WAITING_CHANGED_EVENT = 'agent-waiting-changed';

/** The marks that have not run out yet. Rust is the only source. */
export async function agentWaitingList(): Promise<AgentWaiting[]> {
  return await invoke<AgentWaiting[]>('agent_waiting_list');
}

export function onAgentWaitingChanged(callback: () => void, onListening?: () => void): () => void {
  return subscribeToTauriEvent(
    AGENT_WAITING_CHANGED_EVENT,
    callback,
    '[Browser mode] Agent waiting listener not available',
    onListening
  );
}
