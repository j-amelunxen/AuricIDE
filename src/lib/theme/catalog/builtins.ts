import type { ThemeDefinition } from './types';
import { THEME_SCHEMA_VERSION } from './types';

/**
 * Built-in themes — the six accents that used to live only as CSS
 * `:root[data-accent=…]` blocks. Values match globals.css so apply + data-accent
 * stay consistent.
 */
export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'purple',
    name: 'Auric Purple',
    swatch: '#bc13fe',
    builtin: true,
    tokens: {
      primary: '#bc13fe',
      primaryLight: '#d66aff',
    },
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'blue',
    name: 'Electric Blue',
    swatch: '#2f6bff',
    builtin: true,
    tokens: {
      primary: '#2f6bff',
      primaryLight: '#6b9bff',
    },
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'cyan',
    name: 'Cyan Pulse',
    swatch: '#13d5fe',
    builtin: true,
    tokens: {
      primary: '#13d5fe',
      primaryLight: '#6ae5ff',
    },
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'emerald',
    name: 'Emerald',
    // Picker swatch stays the brighter green users recognise; tokens match CSS.
    swatch: '#13fe9b',
    builtin: true,
    tokens: {
      primary: '#13d98a',
      primaryLight: '#5ff0b4',
    },
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'amber',
    name: 'Amber',
    swatch: '#ffb020',
    builtin: true,
    tokens: {
      primary: '#ffb020',
      primaryLight: '#ffca6a',
    },
  },
  {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: 'pink',
    name: 'Magenta',
    swatch: '#ff3ba7',
    builtin: true,
    tokens: {
      primary: '#ff3ba7',
      primaryLight: '#ff7ac2',
    },
  },
];

export const DEFAULT_THEME_ID = 'purple';

export const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

export function getBuiltinTheme(id: string): ThemeDefinition | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}
