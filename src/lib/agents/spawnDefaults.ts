import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '../config/appConfig';
import type { PermissionMode } from '../tauri/agents';

/** One app-level envelope containing launch choices scoped by working directory. */
export const SPAWN_DEFAULTS_KEY = APP_CONFIG_KEYS.spawnDefaults;

/** The launch choices worth remembering between agents. */
export interface SpawnDefaults {
  providerId: string;
  model: string;
  permissionMode: PermissionMode;
  headless: boolean;
}

interface ScopedSpawnDefaults {
  version: 1;
  global?: SpawnDefaults;
  byWorkingDirectory: Record<string, SpawnDefaults>;
}

function isSpawnDefaults(value: unknown): value is SpawnDefaults {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SpawnDefaults).providerId === 'string' &&
    typeof (value as SpawnDefaults).model === 'string' &&
    typeof (value as SpawnDefaults).permissionMode === 'string' &&
    typeof (value as SpawnDefaults).headless === 'boolean'
  );
}

function workingDirectoryKey(workingDirectory?: string): string | null {
  const normalized = workingDirectory?.trim().replace(/\\/g, '/');
  if (!normalized) return null;
  if (/^\/+$/u.test(normalized)) return '/';
  if (/^[A-Za-z]:\/+$/u.test(normalized)) return `${normalized.slice(0, 2)}/`;
  return normalized.replace(/\/+$/u, '');
}

function readStoredDefaults(): SpawnDefaults | ScopedSpawnDefaults | null {
  const raw = readAppPref(SPAWN_DEFAULTS_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (isSpawnDefaults(parsed)) return parsed;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as ScopedSpawnDefaults).version === 1 &&
    typeof (parsed as ScopedSpawnDefaults).byWorkingDirectory === 'object' &&
    (parsed as ScopedSpawnDefaults).byWorkingDirectory !== null
  ) {
    return parsed as ScopedSpawnDefaults;
  }
  return null;
}

/**
 * The dialog re-asks four questions on every launch; for a fleet the answers
 * are almost always "same as last time". Remembering them turns four
 * decisions per agent into zero — the saved values are still validated
 * against the provider's current offering before they are applied.
 */
export function loadSpawnDefaults(workingDirectory?: string): SpawnDefaults | null {
  try {
    const stored = readStoredDefaults();
    if (!stored) return null;
    const key = workingDirectoryKey(workingDirectory);

    // The old shape was global. Keep it for launches without a repository,
    // but do not let it leak one project's provider into every other project.
    if (isSpawnDefaults(stored)) return key === null ? stored : null;
    const candidate = key === null ? stored.global : stored.byWorkingDirectory[key];
    return isSpawnDefaults(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * The part of a launch a Quick Access skill may pin. `providerId` is the
 * anchor: a model and a permission mode only mean something relative to one.
 */
export interface SpawnPreset {
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
}

/**
 * Folds a skill's preset onto the remembered defaults so the dialog's existing
 * "apply once, but only what the provider still offers" pass validates both
 * through one code path.
 *
 * A preset without a provider is ignored — there would be nothing to validate
 * its model against. Fields the preset leaves open keep the user's last choice
 * only when it belonged to the same provider; otherwise they become `''`, a
 * deliberate sentinel that matches no model and no permission mode, so the
 * dialog degrades to that provider's own defaults. Do not "fix" that to
 * `undefined`: the membership checks compare values, and `''` is what makes a
 * partial preset take the same path as a model the provider has retired.
 */
export function mergeSpawnPreset(
  saved: SpawnDefaults | null,
  preset?: SpawnPreset | null
): SpawnDefaults | null {
  if (!preset?.providerId) return saved;
  const sameProvider = saved?.providerId === preset.providerId;
  return {
    providerId: preset.providerId,
    model: preset.model ?? (sameProvider ? saved!.model : ''),
    permissionMode:
      preset.permissionMode ?? (sameProvider ? saved!.permissionMode : ('' as PermissionMode)),
    // Never part of a preset: how closely you watch a run is a property of the
    // moment, not of the task.
    headless: saved?.headless ?? false,
  };
}

export function saveSpawnDefaults(defaults: SpawnDefaults, workingDirectory?: string): void {
  const key = workingDirectoryKey(workingDirectory);

  // Preserve the compact legacy-compatible shape for launches that have no
  // working directory. Once project entries exist, keep the global bucket in
  // their envelope instead of discarding them.
  if (key === null) {
    try {
      const stored = readStoredDefaults();
      if (stored && !isSpawnDefaults(stored)) {
        writeAppPref(SPAWN_DEFAULTS_KEY, JSON.stringify({ ...stored, global: defaults }));
        return;
      }
    } catch {
      // A corrupt previous value is replaced below.
    }
    writeAppPref(SPAWN_DEFAULTS_KEY, JSON.stringify(defaults));
    return;
  }

  let stored: SpawnDefaults | ScopedSpawnDefaults | null = null;
  try {
    stored = readStoredDefaults();
  } catch {
    // A corrupt previous value becomes an empty scoped store.
  }
  const scoped: ScopedSpawnDefaults =
    stored && !isSpawnDefaults(stored)
      ? stored
      : {
          version: 1,
          global: stored ?? undefined,
          byWorkingDirectory: {},
        };
  writeAppPref(
    SPAWN_DEFAULTS_KEY,
    JSON.stringify({
      ...scoped,
      byWorkingDirectory: { ...scoped.byWorkingDirectory, [key]: defaults },
    })
  );
}
