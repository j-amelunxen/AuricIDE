import type { AgentInfo } from '@/lib/agents/types';
import { isFinishedAgent } from '@/lib/agents/fleet';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';

export interface EndAgentHandlers {
  /** Stop a still-running (or queued) agent. Rejects when it did not stop. */
  onKill?: (agentId: string) => void | Promise<void>;
  /** Clear a stopped agent out of the list. */
  onDismiss?: (agentId: string) => void;
  /** Asks whether a worktree agent's work should be merged; a no-op for any other agent. */
  offerMerge: (agent: AgentInfo) => Promise<void>;
}

/** The question every Stop control asks before ending a working agent. */
export function stopConfirmation(agent: Pick<AgentInfo, 'name'>): ConfirmRequest {
  return {
    title: 'Stop this agent?',
    message: `Stop ${agent.name}? Its work in progress is lost.`,
    confirmLabel: 'Stop',
  };
}

/** Says why an agent is still there after Stop; the card itself stays as it was. */
export function reportStopFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  useStore.getState().showToast(message, 'error');
}

/** Runs a stop and reports its failure once. Resolves to whether it stopped. */
export async function stopWithFeedback(stop: () => void | Promise<void>): Promise<boolean> {
  try {
    await stop();
    return true;
  } catch (error) {
    reportStopFailure(error);
    return false;
  }
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
 * A stop that fails is reported and ends nothing: no `onEnded`, no merge offer.
 * The merge is offered only once the kill has settled, so the worktree is no
 * longer being written to when it is read.
 */
export async function endAgentThenOfferMerge(
  target: AgentInfo,
  handlers: EndAgentHandlers,
  onEnded?: () => void
): Promise<boolean> {
  if (!canEndAgent(target, handlers)) return false;
  if (isFinishedAgent(target)) handlers.onDismiss?.(target.id);
  else if (!(await stopWithFeedback(() => handlers.onKill?.(target.id)))) return false;
  onEnded?.();
  await handlers.offerMerge(target);
  return true;
}
