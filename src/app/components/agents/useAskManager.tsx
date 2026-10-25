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
 * sheet, `sheet` is drawn by the caller. `send` is what the sheet does on
 * Send, for a surface with a field of its own (the runs rail): one path,
 * `useOpenManager().open` with a task, so a running manager gets a message
 * and a stopped one starts.
 */
export function useAskManager(hooks: AskManagerHooks = {}): {
  ask: (manager: Pick<SupervisorManager, 'key' | 'name'>) => void;
  /** Resolves true once the task went in; a refusal has already said why in a toast. */
  send: (manager: Pick<SupervisorManager, 'key'>, task: string) => Promise<boolean>;
  sheet: ReactNode;
} {
  const { open } = useOpenManager(hooks);
  const agents = useStore((s) => s.agents);
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  const [asking, setAsking] = useState<{
    manager: Pick<SupervisorManager, 'key' | 'name'>;
    trigger: HTMLElement | null;
  } | null>(null);

  const send = async (manager: Pick<SupervisorManager, 'key'>, task: string) =>
    (await open(manager.key, { task })) === 'opened';

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
      onSend={(task) => void send(asking.manager, task)}
      onClose={() => setAsking(null)}
    />
  );
  return { ask, send, sheet };
}
