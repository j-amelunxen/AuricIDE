'use client';

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  collectCreatedAt,
  collectModifiedAt,
  dirsWithRecentlyCreatedFile,
  nextRecentlyCreatedExpiry,
} from '@/lib/explorer/recentlyCreated';
import {
  MOVE_MIME,
  isInvalidMove,
  flattenVisibleTree,
  flattenVisibleNodes,
  findNode,
  computeRange,
  parentDir,
  type FileTreeNode,
  type FlatTreeEntry,
} from './fileTreeTypes';
import { TreeNode } from './TreeNode';
import { planRows } from './virtualRows';

export { MOVE_MIME, isInvalidMove, flattenVisibleTree };
export type { FileTreeNode, FlatTreeEntry };

export interface FileExplorerProps {
  tree: FileTreeNode[];
  selectedPath: string | null;
  /** Full multi-selection; falls back to `[selectedPath]` when omitted or empty. */
  selectedPaths?: string[];
  /** Anchor for shift-range selection — the node the last plain/ctrl click landed on. */
  selectionAnchor?: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  /** Moves the selection without opening a tab — what arrow-key navigation should do. */
  onFocusNode?: (path: string) => void;
  onToggleSelect?: (path: string) => void;
  onRangeSelect?: (paths: string[], newPrimary: string) => void;
  onClearSelection?: () => void;
  onDeleteSelection?: (paths: string[]) => void;
  onRenameRequest?: (node: FileTreeNode) => void;
  onNewFile?: () => void;
  onRefresh?: () => void;
  onOpenFolder?: () => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  /** Right-click on the empty area below the tree — targets the project root. */
  onRootContextMenu?: (e: React.MouseEvent) => void;
  /** Move `sourcePath` into `destDir`. Enables drag-and-drop reordering. */
  onMoveNode?: (sourcePath: string, destDir: string) => void;
  /** Project root — enables dropping onto empty space to move an item to the root. */
  rootPath?: string | null;
}

export function FileExplorer({
  tree,
  selectedPath,
  selectedPaths: selectedPathsProp,
  selectionAnchor = null,
  onSelectFile,
  onToggleDir,
  onFocusNode,
  onToggleSelect,
  onRangeSelect,
  onClearSelection,
  onDeleteSelection,
  onRenameRequest,
  onNewFile,
  onRefresh,
  onOpenFolder,
  onContextMenu,
  onRootContextMenu,
  onMoveNode,
  rootPath,
}: FileExplorerProps) {
  const [isRootDropTarget, setIsRootDropTarget] = useState(false);
  const [isRootDropValid, setIsRootDropValid] = useState(true);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const canDropToRoot = !!onMoveNode && !!rootPath;

  const createdAtTimes = useMemo(() => collectCreatedAt(tree), [tree]);
  const modifiedAtTimes = useMemo(() => collectModifiedAt(tree), [tree]);
  // Created and modified share one window and one clock, so a single combined
  // list drives both the "now" reading below and the expiry timer.
  const recentTimes = useMemo(
    () => [...createdAtTimes, ...modifiedAtTimes],
    [createdAtTimes, modifiedAtTimes]
  );

  // `tick` only advances when the expiry timer below fires, so a file the
  // watcher delivers mid-session was born *after* our last reading of the
  // clock. Measured against a stale `tick` its age comes out negative and
  // `isRecentlyCreated` rejects it — the row that should glow brightest would
  // be the one that never does. A birth time ahead of our reading is itself
  // proof of a later moment, so the window is measured from there instead.
  const now = useMemo(
    () =>
      recentTimes.reduce<number>((latest, t) => (t !== undefined && t > latest ? t : latest), tick),
    [recentTimes, tick]
  );

  // One walk per tree (or clock) change instead of one subtree walk per
  // folder row. The set is only swapped when its members differ, so a refresh
  // that lights up nothing new leaves every memoized row alone.
  const computedRecentDirs = useMemo(() => dirsWithRecentlyCreatedFile(tree, now), [tree, now]);
  const [recentDirs, setRecentDirs] = useState<ReadonlySet<string>>(computedRecentDirs);
  if (recentDirs !== computedRecentDirs && !sameMembers(recentDirs, computedRecentDirs)) {
    setRecentDirs(computedRecentDirs);
  }

  useEffect(() => {
    const expiry = nextRecentlyCreatedExpiry(recentTimes, now);
    if (expiry === null) return;
    const id = setTimeout(() => setTick(Date.now()), Math.max(expiry - now, 0));
    return () => clearTimeout(id);
  }, [recentTimes, now]);

  // Defensive fallback: any caller that forgets to keep `selectedPaths` in
  // sync with `selectedPath` still gets a correctly highlighted single row.
  const selectedPaths = useMemo(
    () =>
      selectedPathsProp && selectedPathsProp.length > 0
        ? selectedPathsProp
        : selectedPath
          ? [selectedPath]
          : [],
    [selectedPathsProp, selectedPath]
  );

  // Windowed rendering. An expanded tree can hold thousands of rows; mounting
  // only the ones in (or near) view keeps the DOM and the heap flat. Rows keep
  // their place in normal flow between spacer gaps (`planRows`), and three
  // rows stay mounted wherever they are: the focused one (so focus, and the
  // keyboard handling on this pane, survives scrolling it away), the dragged
  // one (so its dragend still arrives) and one keyboard focus is heading to.
  const rows = useMemo(() => flattenVisibleNodes(tree), [tree]);
  const rowIndex = useMemo(() => new Map(rows.map((row, i) => [row.node.path, i])), [rows]);
  const paneRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [scrollRow, setScrollRow] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    // No layout (jsdom, a pane not yet sized): assume the window's height.
    const measure = () => setViewportHeight(pane.clientHeight || window.innerHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // The row height comes from CSS (`py-0.5` around a 16px line), so it is
  // read off a mounted row rather than assumed — and re-read whenever that row
  // resizes: a font, theme or zoom change alters it without touching the tree.
  // A ResizeObserver reports it without any layout read on our side; the
  // observed row is swapped only when the one watched has left the window.
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const observedRowRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const height =
        entry?.borderBoxSize?.[0]?.blockSize ?? (entry?.target as HTMLElement).offsetHeight;
      if (height > 0) setRowHeight(height);
    });
    rowObserverRef.current = observer;
    return () => {
      observer.disconnect();
      rowObserverRef.current = null;
      observedRowRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const observer = rowObserverRef.current;
    const observed = observedRowRef.current;
    if (!observer || (observed && observed.isConnected)) return;
    if (observed) observer.unobserve(observed);
    const row = paneRef.current?.querySelector(ROW_SELECTOR) ?? null;
    if (row) observer.observe(row);
    observedRowRef.current = row;
  });

  const pinnedPaths = [focusedPath, draggingPath, pendingFocus];
  const plan = planRows({
    count: rows.length,
    rowHeight,
    scrollTop: scrollRow * rowHeight,
    viewportHeight,
    overscan: OVERSCAN_ROWS,
    pinned: pinnedPaths.flatMap((path) => (path === null ? [] : (rowIndex.get(path) ?? []))),
  });

  /** Focus a row, mounting it first when it is outside the window. */
  const focusPath = useCallback((path: string) => {
    const row = findRow(paneRef.current, path);
    if (row) row.focus();
    else setPendingFocus(path);
  }, []);

  // Focusing the now-mounted row lets the browser scroll it into view exactly
  // as it did when every row was mounted.
  useLayoutEffect(() => {
    if (pendingFocus === null) return;
    findRow(paneRef.current, pendingFocus)?.focus();
    // Not cleared: while it names the focused row it pins nothing extra, and
    // the next out-of-window focus replaces it.
  }, [pendingFocus]);

  // Read at click time rather than listed as a dependency: a click handler
  // that changed with every tree would re-render every row on each refresh.
  const treeRef = useRef(tree);
  useEffect(() => {
    treeRef.current = tree;
  });

  const handleNodeClick = useCallback(
    (node: FileTreeNode, e: React.MouseEvent) => {
      if (e.shiftKey && onRangeSelect) {
        e.preventDefault();
        const flat = flattenVisibleTree(treeRef.current);
        const range = computeRange(flat, selectionAnchor ?? selectedPath, node.path);
        onRangeSelect(range, node.path);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
        e.preventDefault();
        onToggleSelect(node.path);
        return;
      }
      if (node.isDirectory) {
        onToggleDir(node.path);
      } else {
        onSelectFile(node.path);
      }
    },
    [selectionAnchor, selectedPath, onRangeSelect, onToggleSelect, onToggleDir, onSelectFile]
  );

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // Every row is a tab stop. With the whole list mounted Tab walked from
        // row to row; at the window's edge the next row is not in the DOM, so
        // step to it here. Inside the window the browser does it natively.
        const from = focusedPath === null ? undefined : rowIndex.get(focusedPath);
        if (from === undefined || e.target !== findRow(paneRef.current, focusedPath!)) return;
        const next = rows[from + (e.shiftKey ? -1 : 1)];
        if (!next || findRow(paneRef.current, next.node.path)) return;
        e.preventDefault();
        focusPath(next.node.path);
        return;
      }
      const flat = flattenVisibleTree(tree);
      if (flat.length === 0) return;
      const paths = flat.map((f) => f.path);
      const currentIndex = selectedPath ? paths.indexOf(selectedPath) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = flat[Math.min(currentIndex + 1, flat.length - 1)] ?? flat[0];
        onFocusNode?.(next.path);
        focusPath(next.path);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = flat[Math.max(currentIndex - 1, 0)];
        onFocusNode?.(prev.path);
        focusPath(prev.path);
      } else if (e.key === 'ArrowRight') {
        if (currentIndex < 0) return;
        const entry = flat[currentIndex];
        const node = findNode(tree, entry.path);
        if (!node?.isDirectory) return;
        e.preventDefault();
        if (!node.expanded) {
          onToggleDir(entry.path);
        } else {
          const child = flat[currentIndex + 1];
          if (child && child.path.startsWith(entry.path + '/')) {
            onFocusNode?.(child.path);
            focusPath(child.path);
          }
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentIndex < 0) return;
        const entry = flat[currentIndex];
        const node = findNode(tree, entry.path);
        e.preventDefault();
        if (entry.isDirectory && node?.expanded) {
          onToggleDir(entry.path);
        } else {
          const parent = flat.find((f) => f.path === parentDir(entry.path));
          if (parent) {
            onFocusNode?.(parent.path);
            focusPath(parent.path);
          }
        }
      } else if (e.key === 'Enter') {
        if (currentIndex < 0) return;
        e.preventDefault();
        const entry = flat[currentIndex];
        if (entry.isDirectory) onToggleDir(entry.path);
        else onSelectFile(entry.path);
      } else if (e.key === 'F2') {
        if (currentIndex < 0 || !onRenameRequest) return;
        const node = findNode(tree, flat[currentIndex].path);
        if (node) {
          e.preventDefault();
          onRenameRequest(node);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!onDeleteSelection) return;
        const targets =
          selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
        if (targets.length === 0) return;
        e.preventDefault();
        onDeleteSelection(targets);
      } else if (e.key === 'Escape') {
        if (selectedPaths.length > 1) onClearSelection?.();
      }
    },
    [
      tree,
      rows,
      rowIndex,
      focusedPath,
      focusPath,
      selectedPath,
      selectedPaths,
      onFocusNode,
      onToggleDir,
      onSelectFile,
      onRenameRequest,
      onDeleteSelection,
      onClearSelection,
    ]
  );

  return (
    <div data-testid="file-explorer" className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-end gap-1 border-b border-white/5 px-2 py-1.5 glass flex-shrink-0">
        <button
          onClick={onOpenFolder}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="Open Folder"
          aria-label="Open Folder"
        >
          <AuricIcon aria-hidden="true" name="create_new_folder" className="text-[16px]" />
        </button>
        <button
          onClick={onNewFile}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="New File"
          aria-label="New File"
        >
          <AuricIcon aria-hidden="true" name="add_box" className="text-[16px]" />
        </button>
        <button
          onClick={onRefresh}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="Refresh"
          aria-label="Refresh"
        >
          <AuricIcon aria-hidden="true" name="refresh" className="text-[16px]" />
        </button>
      </div>
      <div
        ref={paneRef}
        data-testid="file-explorer-root-dropzone"
        onScroll={(e) => setScrollRow(Math.floor(e.currentTarget.scrollTop / rowHeight))}
        className={`py-1 flex-1 overflow-y-auto ${
          isRootDropTarget
            ? isRootDropValid
              ? 'ring-1 ring-inset ring-primary/40 bg-primary/5'
              : 'ring-1 ring-inset ring-red-500/40 bg-red-500/5 cursor-not-allowed'
            : ''
        }`}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={
          onRootContextMenu
            ? (e) => {
                e.preventDefault();
                onRootContextMenu(e);
              }
            : undefined
        }
        onDragOver={
          canDropToRoot
            ? (e) => {
                // Unconditional preventDefault (WebKit-safe — see TreeNode).
                e.preventDefault();
                const valid = draggingPath ? !isInvalidMove(draggingPath, rootPath!) : true;
                e.dataTransfer.dropEffect = valid ? 'move' : 'none';
                setIsRootDropTarget(true);
                setIsRootDropValid(valid);
              }
            : undefined
        }
        onDragLeave={canDropToRoot ? () => setIsRootDropTarget(false) : undefined}
        onDrop={
          canDropToRoot
            ? (e) => {
                e.preventDefault();
                setIsRootDropTarget(false);
                const source = e.dataTransfer.getData(MOVE_MIME);
                if (isInvalidMove(source, rootPath!)) return;
                onMoveNode!(source, rootPath!);
              }
            : undefined
        }
      >
        {plan.map((entry) => {
          if (entry.kind === 'gap') {
            return (
              <div key={`gap-${entry.start}`} aria-hidden="true" style={{ height: entry.height }} />
            );
          }
          const { node, depth } = rows[entry.index];
          return (
            <TreeNode
              key={node.path}
              node={node}
              depth={depth}
              selectedPath={selectedPath}
              selectedPaths={selectedPaths}
              onNodeClick={handleNodeClick}
              onContextMenu={onContextMenu}
              onMoveNode={onMoveNode}
              draggingPath={draggingPath}
              onDragStateChange={setDraggingPath}
              now={now}
              recentDirs={recentDirs}
              onRowFocus={setFocusedPath}
            />
          );
        })}
      </div>
    </div>
  );
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/** Fallback until a row has been measured; matches `py-0.5` around a 16px line. */
const DEFAULT_ROW_HEIGHT = 20;
/** Rows mounted beyond each edge of the pane, so a fast scroll does not show blank space. */
const OVERSCAN_ROWS = 10;
const ROW_SELECTOR = '[data-testid^="tree-item-"]';

/**
 * The mounted row for `path`. Compared as an attribute value rather than built
 * into a selector: inside a CSS string a backslash is an escape, so a Windows
 * path would match no row.
 */
function findRow(pane: HTMLElement | null, path: string): HTMLElement | null {
  const testId = `tree-item-${path}`;
  for (const row of pane?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []) {
    if (row.getAttribute('data-testid') === testId) return row;
  }
  return null;
}
