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
  treeDebounceMs?: number;
  dataDebounceMs?: number;
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
  const { onTreeChange, onProjectDataChange, treeDebounceMs = 300, dataDebounceMs = 500 } = options;

  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  let dataTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    handle: (event) => {
      if (isProjectDbPath(event.path)) {
        clearTimeout(dataTimer);
        dataTimer = setTimeout(onProjectDataChange, dataDebounceMs);
      } else {
        clearTimeout(treeTimer);
        treeTimer = setTimeout(onTreeChange, treeDebounceMs);
      }
    },
    dispose: () => {
      clearTimeout(treeTimer);
      clearTimeout(dataTimer);
    },
  };
}
