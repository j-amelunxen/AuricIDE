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
 * Persist a theme JSON file into the user themes folder (`<app_data>/themes`).
 * Filename must be a bare `*.json` stem — the Rust side rejects path traversal.
 */
export async function importTheme(content: string, filename: string): Promise<ThemeFile> {
  return await invoke<ThemeFile>('import_theme', { content, filename });
}
