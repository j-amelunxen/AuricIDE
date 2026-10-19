import { invoke } from './invoke';

/** One earlier supervisor run folder under `~/.auric/supervisors/` (`supervisor/runs.rs`). */
export interface SupervisorRun {
  /** The folder name, which is the run's start time (`2026-10-16_185017`). */
  name: string;
  path: string;
  /** Newest modification inside the run, ms since the epoch. */
  modifiedAtMs: number | null;
  fileCount: number;
  /** Rust stopped counting; `fileCount` is a floor. */
  truncated: boolean;
}

export interface SupervisorRunFile {
  /** Relative to the run folder, `/`-separated. */
  relativePath: string;
  path: string;
  size: number;
  modifiedAtMs: number | null;
}

/** Every run folder, the one changed most recently first. */
export async function supervisorRunsList(): Promise<SupervisorRun[]> {
  return await invoke<SupervisorRun[]>('supervisor_runs_list');
}

/** The files of one run, newest first. Rust refuses a path that is not a run folder. */
export async function supervisorRunFiles(run: string): Promise<SupervisorRunFile[]> {
  return await invoke<SupervisorRunFile[]>('supervisor_run_files', { run });
}
