import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { supervisorRunsList } from '@/lib/tauri/supervisorRuns';

import { MANAGER_INSTRUCTIONS_FILE } from './managerRail';
import { withoutTrailingSlash } from '@/lib/paths/withoutTrailingSlash';

/** The instructions file inside a manager's run folder. */
export const instructionsPathOf = (runPath: string) =>
  `${withoutTrailingSlash(runPath)}/${MANAGER_INSTRUCTIONS_FILE}`;

/**
 * The manager's instructions file as an absolute path. The registry stores the
 * run folder's name only, so the path comes from the runs list; null when that
 * folder is no longer there.
 */
export async function managerInstructionsPath(manager: SupervisorManager): Promise<string | null> {
  const runs = await supervisorRunsList();
  const run = runs.find((candidate) => candidate.name === manager.runDir);
  return run ? instructionsPathOf(run.path) : null;
}
