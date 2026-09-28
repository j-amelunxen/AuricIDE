'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentState } from '@/lib/agents/state';
import { formatAgentDuration } from '@/lib/agents/duration';
import { useNow } from '@/lib/hooks/useNow';

/**
 * The card's running time — or how long it has been quiet. The only part of
 * a card that changes every second, so it owns the 1-second clock rather than
 * the card.
 */
export function AgentDuration({ agent, state }: { agent: AgentInfo; state: AgentState }) {
  const now = useNow();
  const runtime = formatAgentDuration(now - agent.startedAt);
  const showQuiet =
    (state === 'waiting' || state === 'stalled') && agent.lastActivityAt !== undefined;
  const label = showQuiet
    ? `quiet ${formatAgentDuration(now - (agent.lastActivityAt ?? now))}`
    : runtime;
  const title = showQuiet ? `No output for a while · running for ${runtime}` : 'Running for';
  return (
    <span
      data-testid="agent-runtime"
      title={title}
      className="flex-shrink-0 font-mono tabular-nums"
    >
      {label}
    </span>
  );
}
