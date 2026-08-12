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
