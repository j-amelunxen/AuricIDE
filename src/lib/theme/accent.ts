/**
 * Accent (primary-color) theming.
 *
 * The whole design system drives its primary color off CSS custom properties
 * (`--color-primary`, `--primary`, `--primary-rgb`, …). Switching the accent is
 * therefore just a matter of stamping `data-accent="<id>"` on <html>; the
 * matching `:root[data-accent='…']` block in globals.css overrides those
 * variables and every `*-primary` utility, `neon-glow`, and the focus ring
 * re-tint live. The choice is persisted to localStorage and re-applied before
 * paint by a tiny boot script in layout.tsx (so there is no purple flash).
 */

export interface Accent {
  /** Stable id, also the value of the `data-accent` attribute. */
  id: string;
  /** Human-readable name shown in the picker. */
  label: string;
  /** Representative color for the picker swatch. */
  swatch: string;
}

/** Purple stays the default and matches the base `:root` values in globals.css. */
export const DEFAULT_ACCENT_ID = 'purple';

export const ACCENTS: Accent[] = [
  { id: 'purple', label: 'Auric Purple', swatch: '#bc13fe' },
  { id: 'blue', label: 'Electric Blue', swatch: '#2f6bff' },
  { id: 'cyan', label: 'Cyan Pulse', swatch: '#13d5fe' },
  { id: 'emerald', label: 'Emerald', swatch: '#13fe9b' },
  { id: 'amber', label: 'Amber', swatch: '#ffb020' },
  { id: 'pink', label: 'Magenta', swatch: '#ff3ba7' },
];

export const ACCENT_STORAGE_KEY = 'auric.accent';

export function isAccentId(value: unknown): value is string {
  return typeof value === 'string' && ACCENTS.some((accent) => accent.id === value);
}

/** Reads the persisted accent, falling back to the default on absent/invalid. */
export function loadAccent(): string {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentId(stored) ? stored : DEFAULT_ACCENT_ID;
  } catch {
    return DEFAULT_ACCENT_ID;
  }
}

/** Stamps the accent onto <html> so the CSS variable overrides take effect. */
export function applyAccent(id: string): void {
  const accent = isAccentId(id) ? id : DEFAULT_ACCENT_ID;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.accent = accent;
  }
}

/** Persists and applies the accent. Unknown ids are ignored (no-op). */
export function saveAccent(id: string): void {
  if (!isAccentId(id)) return;
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; still apply for the current session.
  }
  applyAccent(id);
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
