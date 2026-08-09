'use client';

import { useEffect } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useNow } from './useNow';
import { countNeedingAttention, withReviewFlags } from '@/lib/agents/attention';
import { applyDockBadge, applyWindowTitle, composeWindowTitle } from '@/lib/agents/windowTitle';

/**
 * Mirrors the fleet's attention count into the window title, so the one
 * number that decides "do I need to look?" is visible from the dock and from
 * any other app. Only writes when the count actually changes.
 */
export function useAttentionTitle(agents: AgentInfo[], reviewedAgentIds: string[] = []): void {
  const now = useNow();
  const attentionCount = countNeedingAttention(withReviewFlags(agents, reviewedAgentIds), now);

  useEffect(() => {
    void applyWindowTitle(composeWindowTitle(attentionCount));
    // The dock badge reaches even a fully hidden app; zero clears it.
    void applyDockBadge(attentionCount);
  }, [attentionCount]);
}
