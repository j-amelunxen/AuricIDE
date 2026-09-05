'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  collectCreatedAt,
  collectModifiedAt,
  nextRecentlyCreatedExpiry,
} from '@/lib/explorer/recentlyCreated';
import {
  MOVE_MIME,
  isInvalidMove,
  flattenVisibleTree,
  findNode,
  computeRange,
  focusRow,
  parentDir,
  type FileTreeNode,
  type FlatTreeEntry,
} from './fileTreeTypes';
import { TreeNode } from './TreeNode';

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

  const handleNodeClick = useCallback(
    (node: FileTreeNode, e: React.MouseEvent) => {
      if (e.shiftKey && onRangeSelect) {
        e.preventDefault();
        const flat = flattenVisibleTree(tree);
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
    [tree, selectionAnchor, selectedPath, onRangeSelect, onToggleSelect, onToggleDir, onSelectFile]
  );

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const flat = flattenVisibleTree(tree);
      if (flat.length === 0) return;
      const paths = flat.map((f) => f.path);
      const currentIndex = selectedPath ? paths.indexOf(selectedPath) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = flat[Math.min(currentIndex + 1, flat.length - 1)] ?? flat[0];
        onFocusNode?.(next.path);
        focusRow(next.path);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = flat[Math.max(currentIndex - 1, 0)];
        onFocusNode?.(prev.path);
        focusRow(prev.path);
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
            focusRow(child.path);
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
            focusRow(parent.path);
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
        data-testid="file-explorer-root-dropzone"
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
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            onNodeClick={handleNodeClick}
            onContextMenu={onContextMenu}
            onMoveNode={onMoveNode}
            draggingPath={draggingPath}
            onDragStateChange={setDraggingPath}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}
