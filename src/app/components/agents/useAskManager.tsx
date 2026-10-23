'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { liveSupervisorOfManager } from '@/lib/agents/managerStatus';
import { runningSupervisors } from '@/lib/agents/supervisorLaunch';
import { useOpenManager } from '@/lib/hooks/useOpenManager';
import { useStore } from '@/lib/store';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { AskManagerSheet } from './AskManagerSheet';

interface AskManagerHooks {
  onOpenSettings?: (category: 'supervisor') => void;
  onSelectAgent?: (agentId: string) => void;
}

/**
 * "Ask <name>…" for every surface that offers it: `ask(manager)` opens the
 * sheet, `sheet` is drawn by the caller. Sending is `useOpenManager().open`
 * with a task, so a running manager gets a message and a stopped one starts.
 */
export function useAskManager(hooks: AskManagerHooks = {}): {
  ask: (manager: Pick<SupervisorManager, 'key' | 'name'>) => void;
  sheet: ReactNode;
} {
  const { open } = useOpenManager(hooks);
  const agents = useStore((s) => s.agents);
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  const [asking, setAsking] = useState<{
    manager: Pick<SupervisorManager, 'key' | 'name'>;
    trigger: HTMLElement | null;
  } | null>(null);

  const ask = (manager: Pick<SupervisorManager, 'key' | 'name'>) =>
    setAsking({
      manager,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });

  // A menu item is gone by the time the sheet closes; the manager's own control takes the focus.
  const sheet = asking && (
    <AskManagerSheet
      name={asking.manager.name}
      running={liveSupervisorOfManager(live, asking.manager.key) !== undefined}
      returnFocusTo={() =>
        asking.trigger?.isConnected
          ? asking.trigger
          : document.querySelector<HTMLElement>(`[data-manager-focus="${asking.manager.key}"]`)
      }
      onSend={(task) => void open(asking.manager.key, { task })}
      onClose={() => setAsking(null)}
    />
  );
  return { ask, sheet };
}
