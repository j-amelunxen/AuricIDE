import type { AgentWaiting } from './types';

/** The slice of an agent the waiting mark is read from. */
interface WaitingInput {
  waiting?: Pick<AgentWaiting, 'reason' | 'untilMs' | 'markedAtMs'>;
  lastActivityAt?: number;
}

/**
 * The mark on this agent while it still holds: before `until`, and while the
 * agent has said nothing since it was set. Rust ends the mark on new output
 * within one watchdog tick (5 s); reading the same two rules here makes the
 * card and the stall chip react at once instead of at the next event.
 */
export function activeWaiting(agent: WaitingInput, now: number): string | null {
  const mark = agent.waiting;
  if (!mark || now >= mark.untilMs) return null;
  if (agent.lastActivityAt !== undefined && agent.lastActivityAt > mark.markedAtMs) return null;
  return mark.reason;
}

/** "waiting: deploy (until 18:30)", the line an agent card shows while parked. */
export function waitingLabel(reason: string, untilMs: number): string {
  const time = new Date(untilMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `waiting: ${reason} (until ${time})`;
}
