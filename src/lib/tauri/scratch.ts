import { invoke } from './invoke';

/**
 * Resolve the global scratch-files directory (app-data/scratches).
 * The Rust side creates the directory if it does not exist yet.
 */
export async function getScratchDir(): Promise<string> {
  return await invoke<string>('get_scratch_dir');
}
