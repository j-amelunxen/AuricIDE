import type { ThemeDefinition } from './types';
import { allManagedCssProps, buildCssBag } from './tokenMap';
import { BUILTIN_IDS } from './builtins';
import { writeSnapshot } from './storage';

/**
 * Apply a Theme to <html>:
 * - clear previous managed overrides
 * - setProperty for every provided token (dual-write + rgb)
 * - stamp data-theme; also data-accent for builtins (CSS fallback blocks)
 * - persist a snapshot bag for the pre-paint boot script
 */
export function applyTheme(theme: ThemeDefinition): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  clearThemeOverrides();

  // When a theme omits secondary, mirror primary so cleared CSS vars don't fall
  // back to the purple :root defaults under a blue (or other) primary.
  const tokens = {
    ...theme.tokens,
    secondary: theme.tokens.secondary ?? theme.tokens.primary,
    secondaryLight:
      theme.tokens.secondaryLight ?? theme.tokens.primaryLight ?? theme.tokens.primary,
  };
  const bag = buildCssBag(tokens);
  for (const [prop, value] of Object.entries(bag)) {
    root.style.setProperty(prop, value);
  }

  // data-auric-theme (not data-theme) — avoids clashing with light/dark frameworks.
  root.dataset.auricTheme = theme.id;
  if (BUILTIN_IDS.has(theme.id) || theme.builtin) {
    root.dataset.accent = theme.id;
  } else {
    // Custom themes must not leave a stale data-accent that re-tints via CSS.
    delete root.dataset.accent;
  }

  writeSnapshot(bag);
}

/** Remove every CSS property this module might have set. */
export function clearThemeOverrides(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const prop of allManagedCssProps()) {
    root.style.removeProperty(prop);
  }
}
