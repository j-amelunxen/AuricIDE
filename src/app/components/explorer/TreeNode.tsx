import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  hasRecentlyCreatedFile,
  isRecentlyCreated,
  isRecentlyModified,
} from '@/lib/explorer/recentlyCreated';
import { MOVE_MIME, isInvalidMove, type FileTreeNode } from './fileTreeTypes';
import { getFileIcon, gitBadgeMap } from './fileTreeIcons';

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  selectedPaths: string[];
  onNodeClick: (node: FileTreeNode, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  onMoveNode?: (sourcePath: string, destDir: string) => void;
  draggingPath: string | null;
  onDragStateChange: (path: string | null) => void;
  now: number;
}

export function TreeNode({
  node,
  depth,
  selectedPath,
  selectedPaths,
  onNodeClick,
  onContextMenu,
  onMoveNode,
  draggingPath,
  onDragStateChange,
  now,
}: TreeNodeProps) {
  const isSelected = selectedPaths.includes(node.path);
  const isPrimary = selectedPath === node.path;
  const isDraggingSelf = draggingPath === node.path;
  const isIgnored = node.gitStatus === 'ignored';
  const isRecentFile = !node.isDirectory && isRecentlyCreated(node.createdAt, now);
  const isRecentlyModifiedFile = !node.isDirectory && isRecentlyModified(node.modifiedAt, now);
  const containsRecent = node.isDirectory && hasRecentlyCreatedFile(node, now);
  const isRecent = isRecentFile || isRecentlyModifiedFile || containsRecent;
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
        className={`flex w-full items-center gap-1 py-0.5 text-left text-xs transition-[background-color,box-shadow,opacity,color] duration-150 ease-out hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
          isDropTarget
            ? isValidDropTarget
              ? 'bg-primary/20 ring-2 ring-inset ring-primary/60 text-foreground'
              : 'bg-red-500/10 ring-2 ring-inset ring-red-500/50 text-foreground cursor-not-allowed'
            : isDraggingSelf
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
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
