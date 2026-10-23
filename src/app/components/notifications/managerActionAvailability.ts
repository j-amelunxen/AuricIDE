import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';

/**
 * Why an "Open <manager>" button cannot work, or undefined when it can.
 *
 * Until the registry has been read (`loaded`) the list says nothing about any
 * manager, so nothing is disabled. Once it has, an unknown key is gone, even
 * from an empty registry.
 */
export function managerUnavailableReason(
  managerKey: string,
  managers: Pick<SupervisorManager, 'key' | 'archivedAt' | 'runMissing'>[],
  loaded: boolean
): string | undefined {
  if (!loaded) return undefined;
  const found = managers.find((manager) => manager.key === managerKey);
  if (found === undefined) return 'Project Manager not found';
  if (found.archivedAt !== null) return 'Project Manager is archived';
  if (found.runMissing) return 'Project Manager folder missing';
  return undefined;
}

/** Adds the reason to every `open-manager` button that has one; other buttons are left as they are. */
export function withManagerAvailability(
  presented: PresentedAction[],
  managers: Pick<SupervisorManager, 'key' | 'archivedAt' | 'runMissing'>[],
  loaded: boolean
): PresentedAction[] {
  return presented.map((item) => {
    if (item.action.kind !== 'open-manager' || item.disabledReason !== undefined) return item;
    const reason = managerUnavailableReason(item.action.managerKey, managers, loaded);
    return reason === undefined ? item : { ...item, disabledReason: reason };
  });
}
