import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { BUILTIN_IDS, DEFAULT_THEME_ID } from './builtins';

// Application-wide, all three: a theme is a property of the install. They are
// read synchronously because the boot script applies them before first paint.

/** Selected Theme id. */
export const THEME_STORAGE_KEY = APP_CONFIG_KEYS.theme;
/** CSS property bag applied last — used by the boot script to avoid FOUC. */
export const THEME_SNAPSHOT_KEY = APP_CONFIG_KEYS.themeSnapshot;
/** Legacy accent key — still written for builtins so old scripts keep working. */
export const ACCENT_STORAGE_KEY = APP_CONFIG_KEYS.accent;

/** Brief intermediate key from the Seeming rename — still read for migration. */
const LEGACY_SEEMING_STORAGE_KEY = 'auric.seeming';
const LEGACY_SEEMING_SNAPSHOT_KEY = 'auric.seeming.snapshot';

export function readStoredThemeId(): string | null {
  const theme = readAppPref(THEME_STORAGE_KEY);
  if (theme) return theme;
  // Migration: brief Seeming rename, then older accent key.
  const seeming = readAppPref(LEGACY_SEEMING_STORAGE_KEY);
  if (seeming) return seeming;
  return readAppPref(ACCENT_STORAGE_KEY);
}

export function writeStoredThemeId(id: string): void {
  writeAppPref(THEME_STORAGE_KEY, id);
  // Mirror builtins onto the legacy key so pre-Theme boot scripts still work.
  if (BUILTIN_IDS.has(id)) {
    writeAppPref(ACCENT_STORAGE_KEY, id);
  }
}

export function readSnapshot(): Record<string, string> | null {
  try {
    const raw = readAppPref(THEME_SNAPSHOT_KEY) ?? readAppPref(LEGACY_SEEMING_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const bag: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && k.startsWith('--') && typeof v === 'string') {
        bag[k] = v;
      }
    }
    return Object.keys(bag).length > 0 ? bag : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(bag: Record<string, string>): void {
  writeAppPref(THEME_SNAPSHOT_KEY, JSON.stringify(bag));
}

/** Resolve the id to use at boot / first load. */
export function resolveStoredThemeId(knownIds: Set<string>): string {
  const stored = readStoredThemeId();
  if (stored && knownIds.has(stored)) return stored;
  if (stored && BUILTIN_IDS.has(stored)) return stored;
  return DEFAULT_THEME_ID;
}
