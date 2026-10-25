import { invoke } from './invoke';

/** Unified diff of two files on disk; empty when they are identical. */
export async function diffFiles(left: string, right: string): Promise<string> {
  return await invoke<string>('diff_files', { left, right });
}
