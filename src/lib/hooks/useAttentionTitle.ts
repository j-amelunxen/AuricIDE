'use client';

import { useEffect } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useAttentionCount } from './useAttentionCount';
import { applyDockBadge, applyWindowTitle, composeWindowTitle } from '@/lib/agents/windowTitle';

/**
 * Mirrors the fleet's attention count into the window title, so the one
 * number that decides "do I need to look?" is visible from the dock and from
 * any other app. Only writes when the count actually changes.
 *
 * On macOS the title text itself is hidden behind the overlay title bar, so
 * the number reaches the screen through the dock badge and the header's
 * AttentionChip — all three read the same count.
 */
export function useAttentionTitle(agents: AgentInfo[], reviewedAgentIds: string[] = []): void {
  const attentionCount = useAttentionCount(agents, reviewedAgentIds);

  useEffect(() => {
    void applyWindowTitle(composeWindowTitle(attentionCount));
    // The dock badge reaches even a fully hidden app; zero clears it.
    void applyDockBadge(attentionCount);
  }, [attentionCount]);
}
