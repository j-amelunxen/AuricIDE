import { listThemes } from '@/lib/tauri/themes';
import { buildRegistryFromFiles, builtinRegistry, type RegistryLoadResult } from './registry';

/**
 * Load custom themes from disk (Tauri) and merge with built-ins.
 * Browser / test environments without Tauri get built-ins only.
 */
export async function loadThemeRegistry(): Promise<RegistryLoadResult> {
  try {
    const files = await listThemes();
    return buildRegistryFromFiles(
      files.map((f) => ({ path: f.path, content: f.content }))
    );
  } catch {
    return builtinRegistry();
  }
}
