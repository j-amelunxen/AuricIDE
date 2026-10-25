import { memo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { isRecentlyCreated, isRecentlyModified } from '@/lib/explorer/recentlyCreated';
import { type FileTreeNode } from './fileTreeTypes';
import { getFileIcon, gitBadgeMap } from './fileTreeIcons';

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  selectedPaths: string[];
  onNodeClick: (node: FileTreeNode, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  /** Starts a possible drag (see `useTreeDrag`); absent when moving is not wired. */
  onRowMouseDown?: (path: string, e: React.MouseEvent) => void;
  /** This row is part of the items being dragged. */
  isDragged: boolean;
  /** This folder is where the dragged items would land: true valid, false refused. */
  dropState: 'valid' | 'invalid' | null;
  now: number;
  /** Folders holding a recently created file, computed once per tree by the explorer. */
  recentDirs: ReadonlySet<string>;
  /** Tells the windowed list which row holds focus, so it stays mounted. */
  onRowFocus: (path: string) => void;
}

/**
 * One explorer row. The explorer renders the visible tree as a flat, windowed
 * list (see `virtualRows.ts`), so a row no longer renders its children.
 *
 * Memoized: a watcher refresh hands back a tree in which unchanged nodes keep
 * their identity, so only the rows whose node changed re-render. Every other
 * prop is either stable, per row (drag and drop state) or changes for all rows
 * at once (selection).
 */
export const TreeNode = memo(function TreeNode({
  node,
  depth,
  selectedPath,
  selectedPaths,
  onNodeClick,
  onContextMenu,
  onRowMouseDown,
  isDragged,
  dropState,
  now,
  recentDirs,
  onRowFocus,
}: TreeNodeProps) {
  const isSelected = selectedPaths.includes(node.path);
  const isPrimary = selectedPath === node.path;
  const isIgnored = node.gitStatus === 'ignored';
  const isRecentFile = !node.isDirectory && isRecentlyCreated(node.createdAt, now);
  const isRecentlyModifiedFile = !node.isDirectory && isRecentlyModified(node.modifiedAt, now);
  const containsRecent = node.isDirectory && recentDirs.has(node.path);
  const isRecent = isRecentFile || isRecentlyModifiedFile || containsRecent;
  const paddingLeft = `${12 + depth * 16}px`;

  const fileInfo = !node.isDirectory ? getFileIcon(node.name) : null;

  return (
    <button
      data-testid={`tree-item-${node.path}`}
      onClick={(e) => onNodeClick(node, e)}
      onFocus={() => onRowFocus(node.path)}
      onContextMenu={(e) => {
        // Stop here so the empty-area handler on the root dropzone (which
        // bubbling would otherwise reach) doesn't overwrite this with the
        // root context menu.
        e.stopPropagation();
        onContextMenu?.(e, node);
      }}
      onMouseDown={onRowMouseDown ? (e) => onRowMouseDown(node.path, e) : undefined}
      // Read by the drop hit-test (`dropTargetAt`).
      data-tree-path={node.path}
      data-tree-dir={node.isDirectory ? 'true' : undefined}
      data-drop-target={dropState ?? undefined}
      data-selected={isSelected ? 'true' : undefined}
      data-recently-created={isRecentFile ? 'true' : undefined}
      data-recently-modified={isRecentlyModifiedFile ? 'true' : undefined}
      data-contains-recent={containsRecent ? 'true' : undefined}
      title={
        isRecentFile
          ? 'Created in the last 5 minutes'
          : isRecentlyModifiedFile
            ? 'Modified in the last 5 minutes'
            : containsRecent
              ? 'Contains a file created in the last 5 minutes'
              : undefined
      }
      className={`flex w-full select-none items-center gap-1 py-0.5 text-left text-xs transition-[background-color,box-shadow,opacity,color] duration-150 ease-out hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
        dropState
          ? dropState === 'valid'
            ? 'bg-primary/20 ring-2 ring-inset ring-primary/60 text-foreground'
            : 'bg-red-500/10 ring-2 ring-inset ring-red-500/50 text-foreground cursor-not-allowed'
          : isDragged
            ? 'opacity-40'
            : isSelected
              ? `bg-primary/10 text-foreground ${isPrimary ? 'border-l-2 border-primary' : ''}`
              : isIgnored && !isRecent
                ? 'text-foreground-muted opacity-40'
                : isRecent
                  ? 'text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
      } ${
        isRecentFile
          ? 'explorer-recent-glow'
          : isRecentlyModifiedFile
            ? 'explorer-recent-glow-modified'
            : containsRecent
              ? 'explorer-recent-glow-folder'
              : ''
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
        className={`text-[16px] ${
          node.isDirectory
            ? containsRecent
              ? 'text-primary/60'
              : 'text-primary/30'
            : fileInfo?.color || 'text-foreground-muted'
        }`}
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
  );
});
