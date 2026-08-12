import { BUILTIN_IDS, DEFAULT_THEME_ID } from './builtins';

/** Selected Theme id. */
export const THEME_STORAGE_KEY = 'auric.theme';
/** CSS property bag applied last — used by the boot script to avoid FOUC. */
export const THEME_SNAPSHOT_KEY = 'auric.theme.snapshot';
/** Legacy accent key — still written for builtins so old scripts keep working. */
export const ACCENT_STORAGE_KEY = 'auric.accent';

/** Brief intermediate key from the Seeming rename — still read for migration. */
const LEGACY_SEEMING_STORAGE_KEY = 'auric.seeming';
const LEGACY_SEEMING_SNAPSHOT_KEY = 'auric.seeming.snapshot';

export function readStoredThemeId(): string | null {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme) return theme;
    // Migration: brief Seeming rename, then older accent key.
    const seeming = localStorage.getItem(LEGACY_SEEMING_STORAGE_KEY);
    if (seeming) return seeming;
    const accent = localStorage.getItem(ACCENT_STORAGE_KEY);
    return accent;
  } catch {
    return null;
  }
}

export function writeStoredThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
    // Mirror builtins onto the legacy key so pre-Theme boot scripts still work.
    if (BUILTIN_IDS.has(id)) {
      localStorage.setItem(ACCENT_STORAGE_KEY, id);
    }
  } catch {
    // Persistence is best-effort.
  }
}

export function readSnapshot(): Record<string, string> | null {
  try {
    const raw =
      localStorage.getItem(THEME_SNAPSHOT_KEY) ??
      localStorage.getItem(LEGACY_SEEMING_SNAPSHOT_KEY);
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
  try {
    localStorage.setItem(THEME_SNAPSHOT_KEY, JSON.stringify(bag));
  } catch {
    // best-effort
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(THEME_SNAPSHOT_KEY);
  } catch {
    // best-effort
  }
}

/** Resolve the id to use at boot / first load. */
export function resolveStoredThemeId(knownIds: Set<string>): string {
  const stored = readStoredThemeId();
  if (stored && knownIds.has(stored)) return stored;
  if (stored && BUILTIN_IDS.has(stored)) return stored;
  return DEFAULT_THEME_ID;
}
