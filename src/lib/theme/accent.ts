/**
 * Accent (primary-color) theming — compatibility facade over Theme.
 *
 * New code should prefer `@/lib/theme/catalog/*`. This module keeps the
 * historical API (`ACCENTS`, `saveAccent`, `applyAccent`, …) working so
 * existing callers and tests stay green.
 *
 * Under the hood, selecting an accent applies the matching built-in Theme
 * (CSS variables via setProperty + data-accent for the CSS fallback blocks).
 */

import { BUILTIN_THEMES, DEFAULT_THEME_ID, getBuiltinTheme } from './catalog/builtins';
import { applyTheme } from './catalog/apply';
import {
  ACCENT_STORAGE_KEY as STORAGE_KEY,
  readStoredThemeId,
  writeStoredThemeId,
} from './catalog/storage';
import { selectTheme } from './catalog/controller';

export interface Accent {
  /** Stable id, also the value of the `data-accent` attribute. */
  id: string;
  /** Human-readable name shown in the picker. */
  label: string;
  /** Representative color for the picker swatch. */
  swatch: string;
}

/** Purple stays the default and matches the base `:root` values in globals.css. */
export const DEFAULT_ACCENT_ID = DEFAULT_THEME_ID;

export const ACCENTS: Accent[] = BUILTIN_THEMES.map((t) => ({
  id: t.id,
  label: t.name,
  swatch: t.swatch,
}));

export const ACCENT_STORAGE_KEY = STORAGE_KEY;

export function isAccentId(value: unknown): value is string {
  return typeof value === 'string' && ACCENTS.some((accent) => accent.id === value);
}

/** Reads the persisted accent, falling back to the default on absent/invalid. */
export function loadAccent(): string {
  const stored = readStoredThemeId();
  return isAccentId(stored) ? stored : DEFAULT_ACCENT_ID;
}

/** Stamps the accent onto <html> so the CSS variable overrides take effect. */
export function applyAccent(id: string): void {
  const theme = getBuiltinTheme(isAccentId(id) ? id : DEFAULT_ACCENT_ID);
  if (theme) applyTheme(theme);
}

/** Persists and applies the accent. Unknown ids are ignored (no-op). */
export function saveAccent(id: string): void {
  if (!isAccentId(id)) return;
  // Prefer the controller so custom registry state stays consistent when present.
  if (!selectTheme(id)) {
    applyAccent(id);
    writeStoredThemeId(id);
  }
}

/** Fallbacks match the base (purple) `:root` values in globals.css. */
const FALLBACK_PRIMARY = '#bc13fe';
const FALLBACK_PRIMARY_RGB = '188, 19, 254';

/**
 * Resolves a live accent CSS variable to a concrete color string. For contexts
 * that can't consume `var(...)` directly — libraries that parse colors
 * themselves (xterm) or SVG presentation *attributes* (some React Flow markers)
 * — read the computed value here instead of hardcoding purple. This is a
 * snapshot at call time; re-invoke on re-render to pick up a theme change.
 */
function readAccentVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Current primary color as a hex/color string (e.g. `#bc13fe`). */
export function accentColor(): string {
  return readAccentVar('--primary', FALLBACK_PRIMARY);
}

/** Current primary color as bare `r, g, b` channels for `rgba(...)`. */
export function accentRgb(): string {
  return readAccentVar('--primary-rgb', FALLBACK_PRIMARY_RGB);
}
