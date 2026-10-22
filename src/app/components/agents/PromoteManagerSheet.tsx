'use client';

import { useEffect, useState } from 'react';
import { keyFromName, nameFromKey } from '@/lib/agents/supervisorManagers';
import type { AgentInfo } from '@/lib/tauri/agents';
import { machineDependencies } from '@/lib/tauri/machine';
import { managerPromote, type SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { ManagerNameSheet } from './ManagerNameSheet';

const OKF_ID = 'okf';

interface PromoteManagerSheetProps {
  run: SupervisorRun;
  /** The supervisor working in this run, if any. Its key stays the manager's key. */
  liveSupervisor: AgentInfo | undefined;
  /** Every key a new address must avoid: the registry's, archived included, and live supervisors'. */
  takenKeys: readonly string[];
  managers: SupervisorManager[];
  /** The registry could not be read; promoting would write over what we cannot see. */
  registryError?: string | null;
  onPromoted: (manager: SupervisorManager) => void;
  onClose: () => void;
}

/** True only when the machine says okf is not usable; an unreadable report says nothing. */
function useOkfMissing(): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let current = true;
    machineDependencies().then(
      (reports) => {
        if (current) setMissing(reports.some((report) => report.id === OKF_ID && !report.ok));
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, []);
  return missing;
}

/**
 * Names a run and makes it a Project Manager. The address is not editable: a
 * run that already has a key keeps it, otherwise it follows the name.
 */
export function PromoteManagerSheet({
  run,
  liveSupervisor,
  takenKeys,
  managers,
  registryError,
  onPromoted,
  onClose,
}: PromoteManagerSheetProps) {
  const okfMissing = useOkfMissing();
  const ownKey = liveSupervisor?.supervisorKey || undefined;
  return (
    <ManagerNameSheet
      title="Promote to Project Manager"
      confirmLabel="Promote"
      initialName={ownKey ? nameFromKey(ownKey) : ''}
      addressFor={(name) => ownKey ?? keyFromName(name, takenKeys)}
      managers={managers}
      blockedReason={registryError ?? undefined}
      onSubmit={async (name) => onPromoted(await managerPromote(run.name, name))}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2 text-xs text-foreground-muted">
        <p>
          It keeps its folder and everything in it, gets its own instructions file and starts
          keeping notes in knowledge/.
        </p>
        {liveSupervisor && (
          <p>It keeps running as it is and works as a Project Manager from its next start.</p>
        )}
        {okfMissing && (
          <p>
            Memory checks need okf, which is not installed. The Project Manager works without it.
          </p>
        )}
      </div>
    </ManagerNameSheet>
  );
}
