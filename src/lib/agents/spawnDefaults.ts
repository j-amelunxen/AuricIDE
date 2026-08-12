import type { PermissionMode } from '../tauri/agents';

export const SPAWN_DEFAULTS_KEY = 'auric.agent-spawn-defaults';

/** The launch choices worth remembering between agents. */
export interface SpawnDefaults {
  providerId: string;
  model: string;
  permissionMode: PermissionMode;
  headless: boolean;
}

/**
 * The dialog re-asks four questions on every launch; for a fleet the answers
 * are almost always "same as last time". Remembering them turns four
 * decisions per agent into zero — the saved values are still validated
 * against the provider's current offering before they are applied.
 */
export function loadSpawnDefaults(): SpawnDefaults | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SPAWN_DEFAULTS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as SpawnDefaults).providerId !== 'string' ||
      typeof (parsed as SpawnDefaults).model !== 'string' ||
      typeof (parsed as SpawnDefaults).permissionMode !== 'string' ||
      typeof (parsed as SpawnDefaults).headless !== 'boolean'
    ) {
      return null;
    }
    return parsed as SpawnDefaults;
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

export function saveSpawnDefaults(defaults: SpawnDefaults): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    // Storage full or blocked — losing the convenience is fine.
  }
}
