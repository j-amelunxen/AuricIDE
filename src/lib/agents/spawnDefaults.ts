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

export function saveSpawnDefaults(defaults: SpawnDefaults): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    // Storage full or blocked — losing the convenience is fine.
  }
}
