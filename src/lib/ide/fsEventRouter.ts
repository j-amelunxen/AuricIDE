import type { FsChangeEvent } from '@/lib/tauri/watcher';

/**
 * True for the project's SQLite database under .auric/ (project.db plus its
 * WAL/SHM/journal side files). These change whenever the MCP server or an
 * agent writes PM data — the frontend store has no other way to notice.
 */
export function isProjectDbPath(path: string): boolean {
  return /[\\/]\.auric[\\/]project\.db(-wal|-shm|-journal)?$/.test(path);
}

/** The directory a changed path lives in — '/' rather than '' at the top. */
export function parentDirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

export interface FsEventRouterOptions {
  /**
   * Debounced callback for regular file changes. Receives the deduplicated
   * parent directories of everything that changed since the last flush, so the
   * refresh can re-read those instead of walking the whole project.
   */
  onTreeChange: (changedDirs: string[]) => void;
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
  /**
   * Longest a tree refresh may be postponed by fresh events. Without it a
   * process that writes continuously (a dev server, an install) keeps resetting
   * the trailing debounce and the tree never refreshes at all.
   */
  treeMaxWaitMs?: number;
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
    treeMaxWaitMs = 1000,
    dataDebounceMs = 500,
    evidenceDebounceMs = 1000,
  } = options;

  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  let treeMaxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let dataTimer: ReturnType<typeof setTimeout> | undefined;
  let evidenceTimer: ReturnType<typeof setTimeout> | undefined;
  let dirtyDirs = new Set<string>();

  function flushTree(): void {
    clearTimeout(treeTimer);
    clearTimeout(treeMaxWaitTimer);
    treeTimer = undefined;
    treeMaxWaitTimer = undefined;
    const dirs = [...dirtyDirs];
    dirtyDirs = new Set();
    onTreeChange(dirs);
  }

  return {
    handle: (event) => {
      if (isProjectDbPath(event.path)) {
        clearTimeout(dataTimer);
        dataTimer = setTimeout(onProjectDataChange, dataDebounceMs);
      } else {
        dirtyDirs.add(parentDirOf(event.path));
        clearTimeout(treeTimer);
        treeTimer = setTimeout(flushTree, treeDebounceMs);
        // Only armed by the first event of a burst, so it caps the total delay
        // rather than restarting alongside the trailing timer.
        treeMaxWaitTimer ??= setTimeout(flushTree, treeMaxWaitMs);
        if (onEvidenceChange) {
          clearTimeout(evidenceTimer);
          evidenceTimer = setTimeout(onEvidenceChange, evidenceDebounceMs);
        }
      }
    },
    dispose: () => {
      clearTimeout(treeTimer);
      clearTimeout(treeMaxWaitTimer);
      clearTimeout(dataTimer);
      clearTimeout(evidenceTimer);
    },
  };
}
