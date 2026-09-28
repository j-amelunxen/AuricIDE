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

/**
 * True for watcher event kinds that change a file's bytes or metadata but not
 * which paths exist. `kind` is notify's `EventKind` in Debug form
 * (`Modify(Data(Content))`, `Create(File)`, …). Anything unrecognised counts
 * as structural: the cost of guessing wrong that way is a slower refresh,
 * the other way a file list that misses a new file.
 */
export function isContentOnlyKind(kind: string): boolean {
  return (
    kind.startsWith('Modify(Data') ||
    kind.startsWith('Modify(Metadata') ||
    kind.startsWith('Access')
  );
}

/**
 * Whether an event can change which paths exist. A kind that only touches
 * content never can. Otherwise the watcher's `exists` settles it against the
 * file index: a rename over a file the index already lists (how agents and
 * editors save) leaves the set of paths as it was, and so does a temp file
 * that was gone again by the time the batch was sent. Without either fact,
 * assume it did.
 */
export function changesPathSet(
  event: FsChangeEvent,
  isIndexedPath?: (path: string) => boolean
): boolean {
  if (isContentOnlyKind(event.kind)) return false;
  if (event.exists === undefined || !isIndexedPath) return true;
  return event.exists !== isIndexedPath(event.path);
}

function isIgnoreFile(path: string): boolean {
  return /(^|[\\/])\.gitignore$/.test(path);
}

/** What a flushed burst of events amounted to, beyond which folders it touched. */
export interface TreeChangeSummary {
  /** A path may have appeared, vanished or been renamed. */
  structural: boolean;
  /** A `.gitignore` changed: git badges anywhere in the tree may be stale. */
  ignoreRulesChanged: boolean;
}

export interface FsEventRouterOptions {
  /**
   * Debounced callback for regular file changes. Receives the deduplicated
   * parent directories of everything that changed since the last flush, so the
   * refresh can re-read those instead of walking the whole project.
   */
  onTreeChange: (changedDirs: string[], summary: TreeChangeSummary) => void;
  /** Debounced callback for project DB changes (PM/requirements/goals reload). */
  onProjectDataChange: () => void;
  /**
   * Debounced callback for evidence re-evaluation. Non-DB changes feed BOTH
   * the tree and this lane — a file appearing is exactly what a
   * `file_exists` station predicate is waiting for. The router stays dumb:
   * whether any open station cares is the callback's job.
   */
  onEvidenceChange?: () => void;
  /** Whether the project file index lists a path (see `changesPathSet`). */
  isIndexedPath?: (path: string) => boolean;
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
    isIndexedPath,
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
  let summary: TreeChangeSummary = { structural: false, ignoreRulesChanged: false };

  function flushTree(): void {
    clearTimeout(treeTimer);
    clearTimeout(treeMaxWaitTimer);
    treeTimer = undefined;
    treeMaxWaitTimer = undefined;
    const dirs = [...dirtyDirs];
    const flushed = summary;
    dirtyDirs = new Set();
    summary = { structural: false, ignoreRulesChanged: false };
    onTreeChange(dirs, flushed);
  }

  return {
    handle: (event) => {
      if (isProjectDbPath(event.path)) {
        clearTimeout(dataTimer);
        dataTimer = setTimeout(onProjectDataChange, dataDebounceMs);
      } else {
        dirtyDirs.add(parentDirOf(event.path));
        if (changesPathSet(event, isIndexedPath)) summary.structural = true;
        if (isIgnoreFile(event.path)) summary.ignoreRulesChanged = true;
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
