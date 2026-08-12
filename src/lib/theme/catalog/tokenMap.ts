import type { ThemeTokens } from './types';

/**
 * Maps a ThemeTokens key to every CSS custom property that must receive the
 * same value (Tailwind @theme --color-* and the manual :root twins).
 */
export const TOKEN_CSS_PROPS: Record<keyof ThemeTokens, readonly string[]> = {
  primary: ['--primary', '--color-primary'],
  primaryLight: ['--primary-light', '--color-primary-light'],
  primaryForeground: ['--color-primary-foreground'],
  secondary: ['--secondary', '--color-secondary'],
  secondaryLight: ['--secondary-light', '--color-secondary-light'],

  background: ['--background', '--color-background', '--color-background-dark'],
  backgroundSecondary: ['--background-secondary', '--color-background-secondary'],
  surface: ['--color-surface'],
  foreground: ['--foreground', '--color-foreground'],
  foregroundMuted: [
    '--foreground-muted',
    '--color-foreground-muted',
    '--color-muted-foreground',
  ],
  border: ['--border-dark', '--color-border', '--color-border-dark'],
  panelBg: ['--panel-bg', '--color-panel-bg'],
  editorBg: ['--editor-bg', '--color-editor-bg'],
  glassBg: ['--glass-bg', '--color-glass'],
  glassPanelBg: ['--glass-panel-bg', '--color-glass-panel'],
  hoverBg: ['--color-hover-bg'],
  muted: ['--color-muted'],

  gitAdded: ['--git-added', '--color-git-added'],
  gitModified: ['--git-modified', '--color-git-modified'],
  gitDeleted: ['--git-deleted', '--color-git-deleted'],

  bodyGradientFrom: ['--body-gradient-from'],
  bodyGradientTo: ['--body-gradient-to'],
};

/** Token keys that produce an extra `--*-rgb` channel triple for rgba(...). */
export const RGB_DERIVE: Partial<Record<keyof ThemeTokens, string>> = {
  primary: '--primary-rgb',
  primaryLight: '--primary-light-rgb',
  secondary: '--secondary-rgb',
  secondaryLight: '--secondary-light-rgb',
};

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Expand #rgb / #rrggbb / #rrggbbaa into "r, g, b" channels, or null. */
export function hexToRgbChannels(color: string): string | null {
  const trimmed = color.trim();
  if (!HEX_RE.test(trimmed)) return null;
  let hex = trimmed.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  // Drop alpha if present (#rrggbbaa).
  if (hex.length === 8) hex = hex.slice(0, 6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Builds the full CSS property bag for a token set: dual-writes + derived rgb
 * channels when the colour is hex.
 */
export function buildCssBag(tokens: ThemeTokens): Record<string, string> {
  const bag: Record<string, string> = {};

  for (const [key, props] of Object.entries(TOKEN_CSS_PROPS) as Array<
    [keyof ThemeTokens, readonly string[]]
  >) {
    const value = tokens[key];
    if (value === undefined || value === '') continue;
    for (const prop of props) {
      bag[prop] = value;
    }
    const rgbProp = RGB_DERIVE[key];
    if (rgbProp) {
      const channels = hexToRgbChannels(value);
      if (channels) bag[rgbProp] = channels;
    }
  }

  return bag;
}

/** All CSS props we ever write — used when clearing a previous custom apply. */
export function allManagedCssProps(): string[] {
  const props = new Set<string>();
  for (const list of Object.values(TOKEN_CSS_PROPS)) {
    for (const p of list) props.add(p);
  }
  for (const rgb of Object.values(RGB_DERIVE)) {
    if (rgb) props.add(rgb);
  }
  return [...props];
}
