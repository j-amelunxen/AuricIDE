import type { ThemeDefinition, ThemeMeta } from './types';
import { applyTheme } from './apply';
import { BUILTIN_IDS, DEFAULT_THEME_ID } from './builtins';
import {
  builtinRegistry,
  findTheme,
  listMeta,
  type RegistryLoadResult,
} from './registry';
import { loadThemeRegistry } from './loadThemes';
import {
  resolveStoredThemeId,
  writeStoredThemeId,
} from './storage';

export const THEME_CHANGE_EVENT = 'auric-theme-change';

let registry: RegistryLoadResult = builtinRegistry();
let selectedId: string = DEFAULT_THEME_ID;
let hydrated = false;
/** Bumps on every registry/selection change so useSyncExternalStore re-renders. */
let generation = 0;

function knownIds(): Set<string> {
  return new Set(registry.themes.map((t) => t.id));
}

function notify(): void {
  generation += 1;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
}

/** Snapshot string for useSyncExternalStore (id + list size + gen). */
export function getThemeSnapshot(): string {
  return `${selectedId}|${registry.themes.length}|${generation}`;
}

function resolveTheme(id: string): ThemeDefinition | undefined {
  return findTheme(registry.themes, id);
}

/** Current selection id (sync; safe after hydrate / for tests with builtins). */
export function getSelectedThemeId(): string {
  return selectedId;
}

export function getThemeList(): ThemeMeta[] {
  return listMeta(registry.themes);
}

export function getThemeById(id: string): ThemeDefinition | undefined {
  return resolveTheme(id);
}

export function getRegistrySkipped(): RegistryLoadResult['skipped'] {
  return registry.skipped;
}

/**
 * Apply and persist a theme by id. Unknown ids are a no-op (like saveAccent).
 */
export function selectTheme(id: string): boolean {
  const theme = resolveTheme(id);
  if (!theme) return false;
  applyTheme(theme);
  selectedId = theme.id;
  writeStoredThemeId(theme.id);
  notify();
  return true;
}

/**
 * Re-apply the current selection from the registry (e.g. after custom reload).
 * Falls back to default if the stored id vanished.
 */
export function reapplySelectedTheme(): void {
  const id = resolveStoredThemeId(knownIds());
  const theme = resolveTheme(id) ?? resolveTheme(DEFAULT_THEME_ID)!;
  applyTheme(theme);
  selectedId = theme.id;
  writeStoredThemeId(theme.id);
  notify();
}

/**
 * Load customs from disk, rebuild registry, re-apply selection.
 * Safe to call multiple times (Reload Themes).
 */
export async function hydrateThemes(): Promise<RegistryLoadResult> {
  registry = await loadThemeRegistry();
  const id = resolveStoredThemeId(knownIds());
  const theme = resolveTheme(id) ?? resolveTheme(DEFAULT_THEME_ID)!;
  applyTheme(theme);
  selectedId = theme.id;
  writeStoredThemeId(theme.id);
  hydrated = true;
  notify();
  return registry;
}

export function isThemeHydrated(): boolean {
  return hydrated;
}

/**
 * Test / SSR helper: reset module state to built-ins only.
 */
export function resetThemeForTests(themes?: ThemeDefinition[]): void {
  if (themes) {
    registry = {
      themes: themes.map((t) => ({
        ...t,
        builtin: t.builtin === true || BUILTIN_IDS.has(t.id),
      })),
      skipped: [],
      warnings: [],
    };
  } else {
    registry = builtinRegistry();
  }
  selectedId = DEFAULT_THEME_ID;
  hydrated = false;
}

/** Inject a custom theme into the in-memory registry (tests / import preview). */
export function registerCustomThemeForTests(theme: ThemeDefinition): void {
  if (BUILTIN_IDS.has(theme.id)) return;
  if (registry.themes.some((t) => t.id === theme.id)) return;
  registry = {
    ...registry,
    themes: [...registry.themes, { ...theme, builtin: false }],
  };
}
