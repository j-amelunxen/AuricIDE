'use client';

import { useMemo, useState } from 'react';
import { extractHeadings, type HeadingRange } from '@/lib/editor/markdownHeadingParser';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';

export interface HeadingNode {
  heading: HeadingRange;
  children: HeadingNode[];
}

export interface OutlinePanelProps {
  content: string;
  cursorLine: number;
  isMarkdown?: boolean;
  onHeadingClick: (lineNumber: number) => void;
  onRenameHeading?: (title: string, lineNumber: number) => void;
  onExtractSection?: (title: string, lineNumber: number) => void;
}

function buildHeadingTree(headings: HeadingRange[]): HeadingNode[] {
  const root: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { heading, children: [] };

    // Pop stack until we find a parent with lower level
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return root;
}

function getActiveHeading(headings: HeadingRange[], cursorLine: number): HeadingRange | null {
  let active: HeadingRange | null = null;
  for (const h of headings) {
    if (h.lineNumber <= cursorLine) {
      active = h;
    } else {
      break;
    }
  }
  return active;
}

function HeadingItem({
  node,
  depth,
  activeLineNumber,
  onHeadingClick,
  onContextMenu,
}: {
  node: HeadingNode;
  depth: number;
  activeLineNumber: number | null;
  onHeadingClick: (lineNumber: number) => void;
  onContextMenu: (e: React.MouseEvent, heading: HeadingRange) => void;
}) {
  const isActive = activeLineNumber === node.heading.lineNumber;
  const paddingLeft = 12 + depth * 16;

  return (
    <>
      <button
        onClick={() => onHeadingClick(node.heading.lineNumber)}
        onContextMenu={(e) => onContextMenu(e, node.heading)}
        className={`flex w-full items-center gap-2 rounded-md py-1 text-left text-xs transition-colors hover:bg-white/5 ${
          isActive ? 'text-primary font-medium bg-primary/5' : 'text-foreground-muted'
        }`}
        style={{ paddingLeft }}
        title={`Line ${node.heading.lineNumber}`}
      >
        <span className="truncate">{node.heading.title}</span>
      </button>
      {node.children.map((child) => (
        <HeadingItem
          key={`${child.heading.lineNumber}-${child.heading.title}`}
          node={child}
          depth={depth + 1}
          activeLineNumber={activeLineNumber}
          onHeadingClick={onHeadingClick}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

export function OutlinePanel({
  content,
  cursorLine,
  isMarkdown = true,
  onHeadingClick,
  onRenameHeading,
  onExtractSection,
}: OutlinePanelProps) {
  const headings = useMemo(() => extractHeadings(content), [content]);
  const tree = useMemo(() => buildHeadingTree(headings), [headings]);
  const activeHeading = useMemo(
    () => getActiveHeading(headings, cursorLine),
    [headings, cursorLine]
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    heading: HeadingRange;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, heading: HeadingRange) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, heading });
  };

  const contextMenuOptions: ContextMenuOption[] = contextMenu
    ? [
        ...(onRenameHeading
          ? [
              {
                label: 'Rename',
                icon: 'edit',
                action: () => {
                  onRenameHeading(contextMenu.heading.title, contextMenu.heading.lineNumber);
                },
              },
            ]
          : []),
        ...(onExtractSection
          ? [
              {
                label: 'Extract to File',
                icon: 'move_item',
                action: () => {
                  onExtractSection(contextMenu.heading.title, contextMenu.heading.lineNumber);
                },
              },
            ]
          : []),
      ]
    : [];

  if (!isMarkdown) {
    return (
      <div className="flex h-full flex-col bg-panel-bg">
        <h2 className="p-3 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted border-b border-white/5">
          Outline
        </h2>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-xs text-foreground-muted text-center">
            Outline is available for Markdown files
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <h2 className="p-3 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted border-b border-white/5">
        Outline
      </h2>
      <div className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 ? (
          <p className="p-2 text-xs text-foreground-muted text-center">No headings found</p>
        ) : (
          tree.map((node) => (
            <HeadingItem
              key={`${node.heading.lineNumber}-${node.heading.title}`}
              node={node}
              depth={0}
              activeLineNumber={activeHeading?.lineNumber ?? null}
              onHeadingClick={onHeadingClick}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && contextMenuOptions.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
