'use client';

import { useState, useCallback, useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  expanded?: boolean;
  children?: FileTreeNode[];
  gitStatus?: 'added' | 'modified' | 'deleted' | 'ignored';
}

/**
 * Explorer-internal drag payload for moving a node into a folder. Kept separate
 * from the `text/plain` payload (which markdown files also set, so they can be
 * dropped into the editor to embed) so the two drag purposes never collide.
 */
export const MOVE_MIME = 'application/x-auric-move';

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

/** A move is a no-op or illegal if it lands on itself, its own folder, or its subtree. */
export function isInvalidMove(source: string, destDir: string): boolean {
  if (!source) return true;
  if (source === destDir) return true;
  if (parentDir(source) === destDir) return true;
  if (destDir === source || destDir.startsWith(source + '/')) return true;
  return false;
}

export interface FlatTreeEntry {
  path: string;
  isDirectory: boolean;
}

/**
 * Depth-first list of every currently *visible* row (children of collapsed
 * directories excluded) in on-screen order. Shift-range selection and
 * arrow-key navigation both walk this — it's what "next row" actually means.
 */
export function flattenVisibleTree(nodes: FileTreeNode[]): FlatTreeEntry[] {
  const out: FlatTreeEntry[] = [];
  for (const node of nodes) {
    out.push({ path: node.path, isDirectory: node.isDirectory });
    if (node.isDirectory && node.expanded && node.children?.length) {
      out.push(...flattenVisibleTree(node.children));
    }
  }
  return out;
}

function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function computeRange(flat: FlatTreeEntry[], anchor: string | null, target: string): string[] {
  const paths = flat.map((f) => f.path);
  const anchorIndex = anchor ? paths.indexOf(anchor) : -1;
  const targetIndex = paths.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) return [target];
  const [start, end] =
    anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return paths.slice(start, end + 1);
}

function focusRow(path: string): void {
  document.querySelector<HTMLElement>(`[data-testid="tree-item-${path}"]`)?.focus();
}

interface FileExplorerProps {
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

const gitBadgeMap = {
  added: { label: 'A', className: 'text-git-added' },
  modified: { label: 'M', className: 'text-git-modified' },
  deleted: { label: 'D', className: 'text-git-deleted' },
} as const;

function getFileIcon(name: string): { icon: string; color?: string } {
  const ext = name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'md':
    case 'markdown':
      return { icon: 'article', color: 'text-primary-light' };
    case 'ts':
    case 'tsx':
      return { icon: 'javascript', color: 'text-blue-400' };
    case 'js':
    case 'jsx':
      return { icon: 'javascript', color: 'text-yellow-400' };
    case 'rs':
      return { icon: 'settings_b_roll', color: 'text-orange-500' };
    case 'py':
      return { icon: 'terminal', color: 'text-blue-500' };
    case 'json':
      return { icon: 'data_object', color: 'text-yellow-600' };
    case 'html':
      return { icon: 'html', color: 'text-orange-600' };
    case 'css':
      return { icon: 'css', color: 'text-blue-600' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'avif':
      return { icon: 'image', color: 'text-green-400' };
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'm4v':
    case 'ogv':
      return { icon: 'video_file', color: 'text-purple-400' };
    case 'zip':
    case 'tar':
    case 'gz':
      return { icon: 'folder_zip', color: 'text-foreground-muted' };
    case 'workflow': // Custom extension
      return { icon: 'account_tree', color: 'text-primary' };
    default:
      if (name.startsWith('.')) return { icon: 'settings', color: 'text-foreground-muted' };
      return { icon: 'description' };
  }
}

function TreeNode({
  node,
  depth,
  selectedPath,
  selectedPaths,
  onNodeClick,
  onContextMenu,
  onMoveNode,
  draggingPath,
  onDragStateChange,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  selectedPaths: string[];
  onNodeClick: (node: FileTreeNode, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  onMoveNode?: (sourcePath: string, destDir: string) => void;
  draggingPath: string | null;
  onDragStateChange: (path: string | null) => void;
}) {
  const isSelected = selectedPaths.includes(node.path);
  const isPrimary = selectedPath === node.path;
  const isDraggingSelf = draggingPath === node.path;
  const isIgnored = node.gitStatus === 'ignored';
  const paddingLeft = `${12 + depth * 16}px`;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isValidDropTarget, setIsValidDropTarget] = useState(true);

  const fileInfo = !node.isDirectory ? getFileIcon(node.name) : null;
  const isMarkdown = !node.isDirectory && /\.(md|markdown)$/i.test(node.name);
  const canDrop = node.isDirectory && !!onMoveNode;

  return (
    <>
      <button
        data-testid={`tree-item-${node.path}`}
        onClick={(e) => onNodeClick(node, e)}
        onContextMenu={(e) => {
          // Stop here so the empty-area handler on the root dropzone (which
          // bubbling would otherwise reach) doesn't overwrite this with the
          // root context menu.
          e.stopPropagation();
          onContextMenu?.(e, node);
        }}
        draggable
        onDragStart={(e) => {
          // Explorer-internal move payload (every node can be moved)…
          e.dataTransfer.setData(MOVE_MIME, node.path);
          if (isMarkdown) {
            // …plus the editor-embed payload for markdown (drop into the editor).
            e.dataTransfer.setData('text/plain', node.path);
            e.dataTransfer.effectAllowed = 'copyMove';
          } else {
            e.dataTransfer.effectAllowed = 'move';
          }
          onDragStateChange(node.path);
        }}
        onDragEnd={() => onDragStateChange(null)}
        onDragOver={
          canDrop
            ? (e) => {
                // Always preventDefault so the browser permits the drop. WebKit
                // (Tauri's macOS webview) doesn't expose custom MIME types in
                // `types` during dragover, so gating on it would silently block
                // the drop. The actual payload is validated on drop instead.
                e.preventDefault();
                e.stopPropagation(); // don't also light up the root dropzone
                const valid = draggingPath ? !isInvalidMove(draggingPath, node.path) : true;
                e.dataTransfer.dropEffect = valid ? 'move' : 'none';
                setIsDropTarget(true);
                setIsValidDropTarget(valid);
              }
            : undefined
        }
        onDragLeave={canDrop ? () => setIsDropTarget(false) : undefined}
        onDrop={
          canDrop
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDropTarget(false);
                const source = e.dataTransfer.getData(MOVE_MIME);
                if (isInvalidMove(source, node.path)) return;
                onMoveNode!(source, node.path);
              }
            : undefined
        }
        className={`flex w-full items-center gap-1 py-0.5 text-left text-xs transition-all duration-150 ease-out hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
          isDropTarget
            ? isValidDropTarget
              ? 'bg-primary/20 ring-2 ring-inset ring-primary/60 text-foreground'
              : 'bg-red-500/10 ring-2 ring-inset ring-red-500/50 text-foreground cursor-not-allowed'
            : isDraggingSelf
              ? 'opacity-40'
              : isSelected
                ? `bg-primary/10 text-foreground ${isPrimary ? 'border-l-2 border-primary' : ''}`
                : isIgnored
                  ? 'text-foreground-muted opacity-40'
                  : 'text-foreground-muted hover:text-foreground'
        }`}
        style={{ paddingLeft }}
      >
        {node.isDirectory && (
          <AuricIcon
            aria-hidden="true"
            name={node.expanded ? 'expand_more' : 'chevron_right'}
            className="text-[14px] opacity-60"
          />
        )}

        <AuricIcon
          aria-hidden="true"
          name={
            node.isDirectory
              ? node.expanded
                ? 'folder_open'
                : 'folder'
              : fileInfo?.icon || 'description'
          }
          className={`text-[16px] ${node.isDirectory ? 'text-primary/30' : fileInfo?.color || 'text-foreground-muted'}`}
        />

        <span className="flex-1 truncate ml-0.5">{node.name}</span>

        {node.gitStatus && gitBadgeMap[node.gitStatus as keyof typeof gitBadgeMap] && (
          <span
            data-testid={`git-badge-${node.path}`}
            className={`mr-2 text-[9px] font-bold ${gitBadgeMap[node.gitStatus as keyof typeof gitBadgeMap].className} ${node.isDirectory ? 'opacity-50' : ''}`}
          >
            {gitBadgeMap[node.gitStatus as keyof typeof gitBadgeMap].label}
          </span>
        )}
      </button>
      {node.isDirectory && node.expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              selectedPaths={selectedPaths}
              onNodeClick={onNodeClick}
              onContextMenu={onContextMenu}
              onMoveNode={onMoveNode}
              draggingPath={draggingPath}
              onDragStateChange={onDragStateChange}
            />
          ))}
        </div>
      )}
    </>
  );
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
  const canDropToRoot = !!onMoveNode && !!rootPath;

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
          />
        ))}
      </div>
    </div>
  );
}
