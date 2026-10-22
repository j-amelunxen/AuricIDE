import { invoke } from './invoke';

/** One line of the machine report (`machine/check.rs`). `fix` is a command to copy, never to run. */
export interface DependencyReport {
  id: string;
  label: string;
  ok: boolean;
  found: string | null;
  requirement: string;
  /** One sentence, never tool output. */
  detail: string;
  fix: string | null;
  /** The features that need the tool. */
  features: string[];
  /** The version Rust read, when it could. */
  version: string | null;
  /** Where the binary is, whenever it was found. */
  path: string | null;
  /** Found only in an extra folder, not through PATH. Fine, and worth saying. */
  outsidePath: boolean;
}

/** `refresh` re-reads the login shell first: "Check Again" after the human installed something. */
export async function machineDependencies(
  options: { refresh?: boolean } = {}
): Promise<DependencyReport[]> {
  return await invoke<DependencyReport[]>('machine_dependencies', {
    refresh: options.refresh ?? false,
  });
}
