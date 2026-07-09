'use client';

import { useState } from 'react';

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

interface FileExplorerProps {
  tree: FileTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onNewFile?: () => void;
  onRefresh?: () => void;
  onOpenFolder?: () => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
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
      return { icon: 'image', color: 'text-green-400' };
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
  onSelectFile,
  onToggleDir,
  onContextMenu,
  onMoveNode,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  onMoveNode?: (sourcePath: string, destDir: string) => void;
}) {
  const isSelected = selectedPath === node.path;
  const isIgnored = node.gitStatus === 'ignored';
  const paddingLeft = `${12 + depth * 16}px`;
  const [isDropTarget, setIsDropTarget] = useState(false);

  const fileInfo = !node.isDirectory ? getFileIcon(node.name) : null;
  const isMarkdown = !node.isDirectory && /\.(md|markdown)$/i.test(node.name);
  const canDrop = node.isDirectory && !!onMoveNode;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <button
        data-testid={`tree-item-${node.path}`}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu?.(e, node)}
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
        }}
        onDragOver={
          canDrop
            ? (e) => {
                if (e.dataTransfer.types.includes(MOVE_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setIsDropTarget(true);
                }
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
        className={`flex w-full items-center gap-1 py-0.5 text-left text-xs transition-colors hover:bg-white/5 ${
          isDropTarget
            ? 'bg-primary/20 ring-1 ring-inset ring-primary/50 text-foreground'
            : isSelected
              ? 'bg-primary/10 border-l-2 border-primary text-foreground'
              : isIgnored
                ? 'text-foreground-muted opacity-40'
                : 'text-foreground-muted hover:text-foreground'
        }`}
        style={{ paddingLeft }}
      >
        {node.isDirectory && (
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] opacity-60">
            {node.expanded ? 'expand_more' : 'chevron_right'}
          </span>
        )}

        <span
          aria-hidden="true"
          className={`material-symbols-outlined text-[16px] ${node.isDirectory ? 'text-primary/30' : fileInfo?.color || 'text-foreground-muted'}`}
        >
          {node.isDirectory ? (node.expanded ? 'folder_open' : 'folder') : fileInfo?.icon}
        </span>

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
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              onContextMenu={onContextMenu}
              onMoveNode={onMoveNode}
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
  onSelectFile,
  onToggleDir,
  onNewFile,
  onRefresh,
  onOpenFolder,
  onContextMenu,
  onMoveNode,
  rootPath,
}: FileExplorerProps) {
  const [isRootDropTarget, setIsRootDropTarget] = useState(false);
  const canDropToRoot = !!onMoveNode && !!rootPath;

  return (
    <div data-testid="file-explorer" className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-end gap-1 border-b border-white/5 px-2 py-1.5 glass flex-shrink-0">
        <button
          onClick={onOpenFolder}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="Open Folder"
          aria-label="Open Folder"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            create_new_folder
          </span>
        </button>
        <button
          onClick={onNewFile}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="New File"
          aria-label="New File"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            add_box
          </span>
        </button>
        <button
          onClick={onRefresh}
          className="p-1 text-foreground-muted hover:text-foreground transition-colors"
          title="Refresh"
          aria-label="Refresh"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            refresh
          </span>
        </button>
      </div>
      <div
        data-testid="file-explorer-root-dropzone"
        className={`py-1 flex-1 overflow-y-auto ${
          isRootDropTarget ? 'ring-1 ring-inset ring-primary/40 bg-primary/5' : ''
        }`}
        onDragOver={
          canDropToRoot
            ? (e) => {
                if (e.dataTransfer.types.includes(MOVE_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setIsRootDropTarget(true);
                }
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
            onSelectFile={onSelectFile}
            onToggleDir={onToggleDir}
            onContextMenu={onContextMenu}
            onMoveNode={onMoveNode}
          />
        ))}
      </div>
    </div>
  );
}
