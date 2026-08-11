import type { FsChangeEvent } from '@/lib/tauri/watcher';

/**
 * True for the project's SQLite database under .auric/ (project.db plus its
 * WAL/SHM/journal side files). These change whenever the MCP server or an
 * agent writes PM data — the frontend store has no other way to notice.
 */
export function isProjectDbPath(path: string): boolean {
  return /[\\/]\.auric[\\/]project\.db(-wal|-shm|-journal)?$/.test(path);
}

export interface FsEventRouterOptions {
  /** Debounced callback for regular file changes (file tree refresh). */
  onTreeChange: () => void;
  /** Debounced callback for project DB changes (PM/requirements/goals reload). */
  onProjectDataChange: () => void;
  /**
   * Debounced callback for evidence re-evaluation. Non-DB changes feed BOTH
   * the tree and this lane — a file appearing is exactly what a
   * `file_exists` station predicate is waiting for. The router stays dumb:
   * whether any open station cares is the callback's job.
   */
  onEvidenceChange?: () => void;
  treeDebounceMs?: number;
  dataDebounceMs?: number;
  evidenceDebounceMs?: number;
}

export interface FsEventRouter {
  handle: (event: FsChangeEvent) => void;
  dispose: () => void;
}

/**
 * Splits filesystem watcher events into two independent debounce lanes:
 * project DB writes trigger a data reload (Mission Control counts), everything
 * else triggers the file tree refresh. DB write bursts must not churn the tree,
 * and tree changes must not re-read the database.
 */
export function createFsEventRouter(options: FsEventRouterOptions): FsEventRouter {
  const {
    onTreeChange,
    onProjectDataChange,
    onEvidenceChange,
    treeDebounceMs = 300,
    dataDebounceMs = 500,
    evidenceDebounceMs = 1000,
  } = options;

  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  let dataTimer: ReturnType<typeof setTimeout> | undefined;
  let evidenceTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    handle: (event) => {
      if (isProjectDbPath(event.path)) {
        clearTimeout(dataTimer);
        dataTimer = setTimeout(onProjectDataChange, dataDebounceMs);
      } else {
        clearTimeout(treeTimer);
        treeTimer = setTimeout(onTreeChange, treeDebounceMs);
        if (onEvidenceChange) {
          clearTimeout(evidenceTimer);
          evidenceTimer = setTimeout(onEvidenceChange, evidenceDebounceMs);
        }
      }
    },
    dispose: () => {
      clearTimeout(treeTimer);
      clearTimeout(dataTimer);
      clearTimeout(evidenceTimer);
    },
  };
}
