import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { supervisorRunsList } from '@/lib/tauri/supervisorRuns';

export const MANAGER_INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';

/**
 * The manager's instructions file as an absolute path. The registry stores the
 * run folder's name only, so the path comes from the runs list; null when that
 * folder is no longer there.
 */
export async function managerInstructionsPath(manager: SupervisorManager): Promise<string | null> {
  const runs = await supervisorRunsList();
  const run = runs.find((candidate) => candidate.name === manager.runDir);
  return run ? `${run.path.replace(/\/+$/, '')}/${MANAGER_INSTRUCTIONS_FILE}` : null;
}
