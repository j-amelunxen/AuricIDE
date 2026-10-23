'use client';

import { useCallback, useRef, useState } from 'react';
import { openManager, type OpenManagerOptions } from '@/lib/agents/openSupervisor';
import { useStore } from '@/lib/store';

interface OpenManagerHooks {
  /** Nothing is allowed in Settings → Supervisor yet; take the user there. */
  onOpenSettings?: (category: 'supervisor') => void;
  /** Shows the agent's terminal; the store's own selection when not given. */
  onSelectAgent?: (agentId: string) => void;
}

/**
 * Opens a Project Manager by key (a running one is focused) the way every
 * surface does: the Quick Access tile, its submenu and the Settings list.
 * `opening` is the key being started. A ref guards the start itself: state
 * updates only after a render, so two clicks in one tick would both pass it.
 */
export function useOpenManager({ onOpenSettings, onSelectAgent }: OpenManagerHooks = {}) {
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const sendAgentInput = useStore((s) => s.sendAgentInput);
  const selectAgent = useStore((s) => s.selectAgent);
  const showToast = useStore((s) => s.showToast);
  const [opening, setOpening] = useState<string | null>(null);
  const inFlight = useRef(0);

  const open = useCallback(
    async (key: string, options?: OpenManagerOptions) => {
      // A second plain Open adds nothing. An Ask carries work and must not be
      // lost: `openManager` itself lines it up behind the start in flight.
      if (inFlight.current > 0 && !options?.task?.trim()) return;
      inFlight.current += 1;
      setOpening(key);
      try {
        await openManager(
          { spawnSupervisor, showToast, sendAgentInput, agents: useStore.getState().agents },
          key,
          {
            onNothingVisible: () => onOpenSettings?.('supervisor'),
            onShow: onSelectAgent ?? selectAgent,
          },
          options
        );
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setOpening(null);
      }
    },
    [spawnSupervisor, sendAgentInput, showToast, onOpenSettings, onSelectAgent, selectAgent]
  );

  return { open, opening };
}
