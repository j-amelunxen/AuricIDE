import type { ThemeDefinition, ThemeMeta } from './types';
import { BUILTIN_IDS, BUILTIN_THEMES, DEFAULT_THEME_ID, getBuiltinTheme } from './builtins';
import { parseThemeJson } from './schema';

export interface RegistryLoadResult {
  themes: ThemeDefinition[];
  /** Paths or ids that failed validation (for UI hints). */
  skipped: Array<{ source: string; error: string }>;
  warnings: string[];
}

function toMeta(theme: ThemeDefinition): ThemeMeta {
  return {
    id: theme.id,
    name: theme.name,
    swatch: theme.swatch,
    description: theme.description,
    builtin: theme.builtin === true || BUILTIN_IDS.has(theme.id),
  };
}

/**
 * Merge built-ins with custom themes. Custom themes that collide with a
 * reserved built-in id are skipped (built-ins always win).
 */
export function mergeThemes(
  customs: ThemeDefinition[],
  sources: string[] = []
): RegistryLoadResult {
  const themes: ThemeDefinition[] = BUILTIN_THEMES.map((t) => ({ ...t, builtin: true }));
  const seen = new Set(themes.map((t) => t.id));
  const skipped: Array<{ source: string; error: string }> = [];
  const warnings: string[] = [];

  customs.forEach((custom, i) => {
    const source = sources[i] ?? custom.id;
    if (BUILTIN_IDS.has(custom.id) || seen.has(custom.id)) {
      skipped.push({
        source,
        error: `id "${custom.id}" is reserved or already registered`,
      });
      return;
    }
    seen.add(custom.id);
    themes.push({ ...custom, builtin: false });
  });

  return { themes, skipped, warnings };
}

/**
 * Parse raw JSON file payloads into themes, then merge with built-ins.
 * Invalid files are skipped (never throw).
 */
export function buildRegistryFromFiles(
  files: Array<{ path: string; content: string }>
): RegistryLoadResult {
  const customs: ThemeDefinition[] = [];
  const sources: string[] = [];
  const skipped: Array<{ source: string; error: string }> = [];
  const warnings: string[] = [];

  for (const file of files) {
    const result = parseThemeJson(file.content);
    if (!result.ok) {
      skipped.push({ source: file.path, error: result.error });
      continue;
    }
    if (result.warnings.length) {
      warnings.push(...result.warnings.map((w) => `${file.path}: ${w}`));
    }
    // Never trust file content to claim builtin:true.
    const theme = { ...result.theme, builtin: false };
    customs.push(theme);
    sources.push(file.path);
  }

  const merged = mergeThemes(customs, sources);
  return {
    themes: merged.themes,
    skipped: [...skipped, ...merged.skipped],
    warnings: [...warnings, ...merged.warnings],
  };
}

/** Built-ins only — browser / test fallback. */
export function builtinRegistry(): RegistryLoadResult {
  return {
    themes: BUILTIN_THEMES.map((t) => ({ ...t, builtin: true })),
    skipped: [],
    warnings: [],
  };
}

export function listMeta(themes: ThemeDefinition[]): ThemeMeta[] {
  return themes.map(toMeta);
}

export function findTheme(
  themes: ThemeDefinition[],
  id: string
): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id) ?? getBuiltinTheme(id);
}

export function defaultTheme(): ThemeDefinition {
  return getBuiltinTheme(DEFAULT_THEME_ID)!;
}
