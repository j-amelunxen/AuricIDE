'use client';

import { useCallback, useState } from 'react';
import { openManager } from '@/lib/agents/openSupervisor';
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
 * `opening` is the key being started, so one click cannot start it twice.
 */
export function useOpenManager({ onOpenSettings, onSelectAgent }: OpenManagerHooks = {}) {
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const selectAgent = useStore((s) => s.selectAgent);
  const showToast = useStore((s) => s.showToast);
  const [opening, setOpening] = useState<string | null>(null);

  const open = useCallback(
    async (key: string) => {
      if (opening) return;
      setOpening(key);
      try {
        await openManager({ spawnSupervisor, showToast }, key, {
          onNothingVisible: () => onOpenSettings?.('supervisor'),
          onShow: onSelectAgent ?? selectAgent,
        });
      } finally {
        setOpening(null);
      }
    },
    [opening, spawnSupervisor, showToast, onOpenSettings, onSelectAgent, selectAgent]
  );

  return { open, opening };
}
