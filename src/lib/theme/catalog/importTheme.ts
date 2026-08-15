import { importTheme } from '@/lib/tauri/themes';
import { BUILTIN_IDS } from './builtins';
import { parseThemeJson } from './schema';
import type { ThemeDefinition } from './types';

export type ImportThemeResult =
  { ok: true; theme: ThemeDefinition; path: string } | { ok: false; error: string };

export type ThemeWriteFn = (content: string, filename: string) => Promise<{ path: string }>;

async function defaultWrite(content: string, filename: string): Promise<{ path: string }> {
  return importTheme(content, filename);
}

function describeWriteError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not write the theme file';
}

/**
 * Validate a theme JSON payload, then persist it as `<id>.json` in the
 * user themes folder. Built-in ids are refused so a custom file cannot
 * shadow a shipped theme.
 */
export async function importCustomTheme(
  json: string,
  write: ThemeWriteFn = defaultWrite
): Promise<ImportThemeResult> {
  const parsed = parseThemeJson(json);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  if (BUILTIN_IDS.has(parsed.theme.id)) {
    return {
      ok: false,
      error: `id "${parsed.theme.id}" is reserved for a built-in theme`,
    };
  }

  try {
    const written = await write(json, `${parsed.theme.id}.json`);
    return { ok: true, theme: parsed.theme, path: written.path };
  } catch (error) {
    return { ok: false, error: describeWriteError(error) };
  }
}
