'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { countNeedingAttention, withReviewFlags } from '@/lib/agents/attention';
import { useNow } from './useNow';

/**
 * How many agents need a human right now, re-read on the shared clock.
 *
 * The one number the window title, the dock badge and the title-bar chip all
 * state — they must never disagree, so none of them counts for itself.
 *
 * Ticking every second re-renders whoever calls this, so call it from the
 * smallest component that shows the number, never from a page: otherwise the
 * whole tree repaints once a second for a digit that rarely changes.
 */
export function useAttentionCount(agents: AgentInfo[], reviewedAgentIds: string[] = []): number {
  const now = useNow();
  return countNeedingAttention(withReviewFlags(agents, reviewedAgentIds), now);
}
