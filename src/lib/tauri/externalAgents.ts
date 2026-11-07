import type { ExternalAgent } from '@/lib/agents/externalAgents';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

/** Every entry on this machine; the timeline picks what belongs to it. */
export async function externalAgentsList(): Promise<ExternalAgent[]> {
  return await invoke<ExternalAgent[]>('external_agents_list');
}

type ExternalEndReason = NonNullable<ExternalAgent['endReason']>;

export interface ExternalAgentCloseOptions {
  /** Needed to correct an entry that is already final; audited. */
  force?: boolean;
  /** Unix ms. On a live entry the default is now. */
  finishedAt?: number;
  endReason?: ExternalEndReason;
}

/**
 * The human's way out for an entry whose stop never comes: books it without a
 * runtime. With `force`, it also corrects the end of an entry that is already final.
 */
export async function externalAgentClose(
  id: string,
  options: ExternalAgentCloseOptions = {}
): Promise<void> {
  await invoke<unknown>('external_agent_close', { id, ...options });
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
