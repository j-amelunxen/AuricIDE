import { APP_CONFIG_KEYS, readAppPref, removeAppPref, writeAppPref } from './appConfig';
import type { SupervisorPolicy } from './supervisorPolicy';

/**
 * Derives the active supervisor candidate provider IDs from the policy.
 * Defaults to `[policy.supervisor.provider]` or `['claude']` when absent.
 */
export function supervisorProvidersOf(policy: SupervisorPolicy): string[] {
  const list = policy.supervisor.providers?.map((p) => p.trim()).filter((p) => p.length > 0);
  if (list && list.length > 0) {
    return [...new Set(list)];
  }
  const fallback = policy.supervisor.provider?.trim();
  return fallback ? [fallback] : ['claude'];
}

/**
 * Parses the raw stored instructions preference value.
 * Supports legacy plain strings (interpreted as { claude: string }) and
 * serialized JSON maps of provider ID -> instruction string.
 */
export function readAllSupervisorInstructions(): Record<string, string> {
  const raw = readAppPref(APP_CONFIG_KEYS.supervisorInstructions);
  if (!raw || !raw.trim()) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'string' && val.trim()) {
            result[key] = val;
          }
        }
        return result;
      }
    } catch {
      // Fall through to plain text
    }
  }
  return { claude: raw };
}

/**
 * Reads instructions for a specific provider.
 * When `providerId` is omitted, defaults to `'claude'`.
 */
export function readSupervisorInstructions(providerId?: string): string {
  const all = readAllSupervisorInstructions();
  const id = providerId?.trim().toLowerCase() || 'claude';
  return all[id] ?? '';
}

/**
 * Saves supervisor instructions. Accepts either a full map of provider -> instruction
 * or a single text string with an optional provider ID (defaults to 'claude').
 * If all entries are empty, the preference key is removed.
 */
export function writeSupervisorInstructions(
  value: string | Record<string, string>,
  providerId?: string
): void {
  const current = readAllSupervisorInstructions();
  let updated: Record<string, string>;

  if (typeof value === 'string') {
    const id = providerId?.trim().toLowerCase() || 'claude';
    if (value.trim()) {
      updated = { ...current, [id]: value };
    } else {
      updated = { ...current };
      delete updated[id];
    }
  } else {
    updated = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.trim()) {
        updated[k.trim().toLowerCase()] = v;
      }
    }
  }

  const keys = Object.keys(updated);
  if (keys.length === 0) {
    removeAppPref(APP_CONFIG_KEYS.supervisorInstructions);
  } else if (keys.length === 1 && keys[0] === 'claude') {
    writeAppPref(APP_CONFIG_KEYS.supervisorInstructions, updated.claude);
  } else {
    writeAppPref(APP_CONFIG_KEYS.supervisorInstructions, JSON.stringify(updated));
  }
}
