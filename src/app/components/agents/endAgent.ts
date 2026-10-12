import type { AgentInfo } from '@/lib/tauri/agents';
import { isFinishedAgent } from '@/lib/agents/fleet';

export interface EndAgentHandlers {
  /** Stop a still-running (or queued) agent. */
  onKill?: (agentId: string) => void | Promise<void>;
  /** Clear a stopped agent out of the list. */
  onDismiss?: (agentId: string) => void;
  /** Asks whether a worktree agent's work should be merged; a no-op for any other agent. */
  offerMerge: (agent: AgentInfo) => Promise<void>;
}

/** Whether there is a handler for the way this agent would end: dismiss when finished, kill otherwise. */
export function canEndAgent(
  target: AgentInfo,
  handlers: Pick<EndAgentHandlers, 'onKill' | 'onDismiss'>
): boolean {
  return isFinishedAgent(target) ? !!handlers.onDismiss : !!handlers.onKill;
}

/**
 * End an agent, then offer the merge. No question is asked here: whoever calls
 * this has already had "Stop this agent?" answered, wherever it was clicked.
 * The merge is offered only once the kill has settled, so the worktree is no
 * longer being written to when it is read.
 */
export async function endAgentThenOfferMerge(
  target: AgentInfo,
  handlers: EndAgentHandlers
): Promise<void> {
  if (!canEndAgent(target, handlers)) return;
  if (isFinishedAgent(target)) handlers.onDismiss?.(target.id);
  else await Promise.resolve(handlers.onKill?.(target.id));
  await handlers.offerMerge(target);
}
