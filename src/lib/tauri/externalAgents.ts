import type { ExternalAgent } from '@/lib/agents/externalAgents';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

/** Every entry on this machine; the timeline picks what belongs to it. */
export async function externalAgentsList(): Promise<ExternalAgent[]> {
  return await invoke<ExternalAgent[]>('external_agents_list');
}

/** The human's way out for an entry whose stop never comes: books it without a runtime. */
export async function externalAgentClose(id: string): Promise<void> {
  await invoke<unknown>('external_agent_close', { id });
}

export function onExternalAgentsChanged(
  callback: () => void,
  onListening?: () => void
): () => void {
  return subscribeToTauriEvent(
    'external-agents-changed',
    callback,
    '[Browser mode] External agents listener not available',
    onListening
  );
}
