import { invoke } from './invoke';

/**
 * One Project Manager: a supervisor run the human chose to keep
 * (`supervisor/managers.rs`, `docs/design-project-manager.md`). The registry in
 * `<app_data_dir>/supervisor-managers.json` is the truth, never the run folder.
 */
export interface SupervisorManager {
  /** The identity and the supervisor key it runs under. Never changes. */
  key: string;
  name: string;
  /** A folder name under the runs root, not a path. */
  runDir: string;
  promotedAt: string;
  archivedAt: string | null;
  /** What the last start injected; null before the first start after promotion. */
  lastLaunch: { at: string; instructionsSha256: string } | null;
}

/** What `okf validate` came to on this machine; `never` before the first check. */
export type OkfState =
  'ok' | 'findings' | 'missing' | 'outdated' | 'unrecognised' | 'failed' | 'never';

/** One thing the memory check found, from our layout check or from okf. */
export interface ManagerMemoryFinding {
  source: 'layout' | 'okf';
  code: string;
  /** Relative to `knowledge/`, when the finding is about one file. */
  path: string | null;
  message: string;
}

export interface ManagerMemorySummary {
  /** Concept count per section type (`Decision`, `Fact`, …). */
  concepts: Record<string, number>;
  deprecated: number;
  /** Newest change in the bundle, ms since the epoch. */
  newestChangeMs: number | null;
  /** Both checks, layout first. */
  findings: ManagerMemoryFinding[];
  okf: OkfState;
  checkedAt: string | null;
}

/** What `manager_list` answers: the managers, or why the registry could not be read. */
export interface ManagerRegistry {
  managers: SupervisorManager[];
  /** The `registry_unreadable` sentence. The file was left as it is; offer no writes. */
  error: string | null;
}

/** For the UI, which shows the error and disables promote/rename/archive while it lasts. */
export async function managerRegistry(): Promise<ManagerRegistry> {
  return await invoke<ManagerRegistry>('manager_list');
}

/**
 * For launches: every manager, archived ones included, or a throw with the
 * registry's error, so a file we could not read is never taken for an empty one.
 */
export async function supervisorManagersList(): Promise<SupervisorManager[]> {
  const { managers, error } = await managerRegistry();
  if (error) throw error;
  return managers;
}

/**
 * Fired on `window` after every change to the registry, so a surface that lists
 * managers (Quick Access, the menu bar, Settings) reads it again without
 * waiting for the next focus.
 */
export const MANAGERS_CHANGED_EVENT = 'auric:managers-changed';

async function changeRegistry<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await invoke<T>(command, args);
  window.dispatchEvent(new Event(MANAGERS_CHANGED_EVENT));
  return result;
}

export async function managerPromote(runDir: string, name: string): Promise<SupervisorManager> {
  return await changeRegistry<SupervisorManager>('manager_promote', { runDir, name });
}

export async function managerRename(key: string, name: string): Promise<SupervisorManager> {
  return await changeRegistry<SupervisorManager>('manager_rename', { key, name });
}

export async function managerArchive(key: string): Promise<SupervisorManager> {
  return await changeRegistry<SupervisorManager>('manager_archive', { key });
}

export async function managerRestore(key: string): Promise<SupervisorManager> {
  return await changeRegistry<SupervisorManager>('manager_restore', { key });
}

/** Only for archived managers; the folder stays and becomes an ordinary run. */
export async function managerRemove(key: string): Promise<void> {
  await changeRegistry<void>('manager_remove', { key });
}

/** The text of `INSTRUCTIONS.md`, null when the file is missing. Rust caps it at 16 KiB. */
export async function managerInstructions(key: string): Promise<string | null> {
  return await invoke<string | null>('manager_instructions', { key });
}

/** The summary from the last check, stored in `managers/<key>/validation.json`. */
export async function managerMemory(key: string): Promise<ManagerMemorySummary> {
  return await invoke<ManagerMemorySummary>('manager_memory', { key });
}

/** Runs both checks now (the inspector's "Validate Memory") and returns the new summary. */
export async function managerValidate(key: string): Promise<ManagerMemorySummary> {
  return await invoke<ManagerMemorySummary>('manager_validate', { key });
}
