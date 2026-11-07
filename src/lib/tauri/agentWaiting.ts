import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

/** One agent a supervisor parked on purpose (`mark_waiting`), as Rust keeps it. */
export interface AgentWaiting {
  agentId: string;
  reason: string;
  /** Unix ms at which the mark ends by itself. */
  untilMs: number;
  /** Unix ms at which it was set. */
  markedAtMs: number;
}

/** The marks that have not run out yet. Rust is the only source. */
export async function agentWaitingList(): Promise<AgentWaiting[]> {
  return await invoke<AgentWaiting[]>('agent_waiting_list');
}

export function onAgentWaitingChanged(callback: () => void, onListening?: () => void): () => void {
  return subscribeToTauriEvent(
    'agent-waiting-changed',
    callback,
    '[Browser mode] Agent waiting listener not available',
    onListening
  );
}
