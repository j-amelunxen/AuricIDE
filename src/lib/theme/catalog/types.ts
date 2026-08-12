/**
 * Theme contract (schemaVersion 1).
 *
 * Built-ins and user JSON share this shape. Only `tokens.primary` is required
 * under tokens; everything else falls through to the :root defaults in globals.css.
 */

export const THEME_SCHEMA_VERSION = 1 as const;

/** Optional surface / chrome tokens. Missing keys keep the CSS :root defaults. */
export interface ThemeTokens {
  primary: string;
  /** Lighter primary — same hue family (badges, selected chrome text). */
  primaryLight?: string;
  primaryForeground?: string;
  /**
   * Optional second accent (e.g. pride pink). Use for intentional highlights,
   * not for text that sits on a primary wash — that stays `primaryLight`.
   */
  secondary?: string;
  secondaryLight?: string;

  background?: string;
  backgroundSecondary?: string;
  surface?: string;
  foreground?: string;
  foregroundMuted?: string;
  border?: string;
  panelBg?: string;
  editorBg?: string;
  /** Header / toolbar glass strips (defaults to panelBg when unset). */
  glassBg?: string;
  /** Side glass panels (defaults to panelBg when unset). */
  glassPanelBg?: string;
  hoverBg?: string;
  muted?: string;

  gitAdded?: string;
  gitModified?: string;
  gitDeleted?: string;

  bodyGradientFrom?: string;
  bodyGradientTo?: string;
}

export interface ThemeDefinition {
  schemaVersion: typeof THEME_SCHEMA_VERSION | number;
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** Swatch colour shown in the picker. */
  swatch: string;
  tokens: ThemeTokens;
  /** True when this theme ships with the app (not loaded from themes/). */
  builtin?: boolean;
}

/** Lightweight row for pickers and lists. */
export interface ThemeMeta {
  id: string;
  name: string;
  swatch: string;
  description?: string;
  builtin: boolean;
}

export type ParseThemeResult =
  | { ok: true; theme: ThemeDefinition; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };
