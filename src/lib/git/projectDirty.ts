import { getProjectsDirty, type ProjectDirty } from '@/lib/tauri/git';

/** Indexes probe rows by the path the backend echoed — the starred-project key. */
export function dirtyByPath(rows: ProjectDirty[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const row of rows) {
    map[row.path] = row.dirty;
  }
  return map;
}

/**
 * Ask the backend which of these project folders have uncommitted work.
 * An empty list never hits IPC. A failed probe is an empty map: tiles stay
 * unmarked rather than guessing.
 */
export async function loadProjectsDirty(paths: string[]): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  try {
    return dirtyByPath(await getProjectsDirty(paths));
  } catch {
    return {};
  }
}
