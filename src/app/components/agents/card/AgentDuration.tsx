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
  // A headless run's silence is its normal state, so its runtime is the
  // number that matters — and the word says why the card is quiet.
  const showQuiet =
    !agent.headless &&
    (state === 'waiting' || state === 'stalled') &&
    agent.lastActivityAt !== undefined;
  const label = showQuiet
    ? `quiet ${formatAgentDuration(now - (agent.lastActivityAt ?? now))}`
    : agent.headless && agent.status === 'running'
      ? `headless · ${runtime}`
      : runtime;
  const title = showQuiet
    ? `No output for a while · running for ${runtime}`
    : agent.headless
      ? 'Running headless for — output arrives when the run ends'
      : 'Running for';
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
