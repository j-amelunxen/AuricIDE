'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { loadAppConfig } from '@/lib/config/appConfig';

/**
 * Opens the Agent Console once per app session when the start screen is
 * showing (no project open) and an agent is already running — but only when
 * the preference for it is on.
 *
 * "Once" is a ref, not a condition that re-fires: without it, closing the
 * console by hand would get overridden the next time an agent starts running
 * while still on the start screen.
 */
export function useAgentConsoleAutoOpen(): void {
  const rootPath = useStore((s) => s.rootPath);
  const hasRunningAgent = useStore((s) => s.agents.some((a) => a.status === 'running'));
  const openAgentConsole = useStore((s) => s.openAgentConsole);
  const hasAutoOpened = useRef(false);

  useEffect(() => {
    if (hasAutoOpened.current) return;
    if (rootPath !== null || !hasRunningAgent) return;
    if (!loadAppConfig().agentConsoleAutoOpen) return;

    hasAutoOpened.current = true;
    openAgentConsole();
  }, [rootPath, hasRunningAgent, openAgentConsole]);
}
