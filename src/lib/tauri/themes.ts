import { invoke } from './invoke';

/** Raw theme file discovered by the Rust scanner (validation is TS-side). */
export interface ThemeFile {
  path: string;
  content: string;
}

/**
 * List user-supplied Theme JSON files from themes/ search paths.
 * Throws in browser mode — callers should catch and fall back to built-ins.
 */
export async function listThemes(): Promise<ThemeFile[]> {
  return await invoke<ThemeFile[]>('list_themes');
}

/**
 * Persist a theme JSON under app_data/themes/{id}.json and return the raw file.
 * Full validation still happens on the TS side after re-list.
 */
export async function importTheme(json: string): Promise<ThemeFile> {
  return await invoke<ThemeFile>('import_theme', { json });
}
