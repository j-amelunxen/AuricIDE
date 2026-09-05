'use client';

import { useCallback, useMemo, type MouseEvent } from 'react';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { revealInFileManager } from '@/lib/tauri/opener';
import { toGitignoreEntry } from '@/lib/git/gitignore';
import { type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import type { useIDEState } from '../useIDEState';

/** Label matches each OS's own file manager, following VS Code's convention. */
function revealInFileManagerLabel(): string {
  if (typeof window === 'undefined') return 'Reveal in File Manager';
  const platform = window.navigator.platform;
  if (platform.includes('Mac')) return 'Reveal in Finder';
  if (platform.includes('Win')) return 'Reveal in File Explorer';
  return 'Show in File Manager';
}

export interface UseContextMenuOptionsProps {
  state: ReturnType<typeof useIDEState>;
  clipboard: { path: string; isDirectory: boolean } | null;
  setClipboard: (c: { path: string; isDirectory: boolean } | null) => void;
  handleCopyPath: (path: string) => void;
  handleCopyPaths: (paths: string[]) => void;
  handleDeleteSelection: (paths: string[]) => Promise<void>;
  handleRenameRequest: (node: FileTreeNode) => void;
  handlePaste: (path: string) => Promise<void>;
  handleOpenTerminalHere: (folderPath: string) => void;
  handleNewDiagram: (parentDir?: string) => Promise<void>;
  handleCreateTicketFromMarkdown: (node: FileTreeNode) => Promise<void>;
  handleAddToGitignore: (node: FileTreeNode) => Promise<void>;
  handleIgnoreGitRepo: (absPath: string) => Promise<void>;
}

export function useContextMenuOptions({
  state,
  clipboard,
  setClipboard,
  handleCopyPath,
  handleCopyPaths,
  handleDeleteSelection,
  handleRenameRequest,
  handlePaste,
  handleOpenTerminalHere,
  handleNewDiagram,
  handleCreateTicketFromMarkdown,
  handleAddToGitignore,
  handleIgnoreGitRepo,
}: UseContextMenuOptionsProps) {
  const handleContextMenu = useCallback(
    (e: MouseEvent, node: FileTreeNode) => {
      e.preventDefault();
      state.setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [state]
  );

  const handleRootContextMenu = useCallback(
    (e: MouseEvent) => {
      const rootPath = state.rootPath;
      if (!rootPath) return;
      e.preventDefault();
      state.setContextMenu({
        x: e.clientX,
        y: e.clientY,
        node: { path: rootPath, name: '', isDirectory: true },
      });
    },
    [state]
  );

  const handleRevealInFileManager = useCallback((path: string) => {
    revealInFileManager(path);
  }, []);

  const contextMenuOptions = useMemo<ContextMenuOption[]>(() => {
    if (!state.contextMenu) return [];
    const { node } = state.contextMenu;
    const isRootContext = node.path === state.rootPath && node.name === '';
    const isMultiTarget = state.selectedPaths.length > 1 && state.selectedPaths.includes(node.path);
    const parentDir = node.isDirectory ? node.path : node.path.split('/').slice(0, -1).join('/');

    const options: ContextMenuOption[] = [
      {
        label: 'New Folder',
        icon: 'create_new_folder',
        action: () => state.setNewItemModal({ type: 'folder', parentDir }),
      },
      {
        label: 'New File',
        icon: 'note_add',
        action: () => state.setNewItemModal({ type: 'file', parentDir }),
      },
      {
        label: 'New Diagram',
        icon: 'draw',
        action: () => handleNewDiagram(parentDir),
      },
    ];

    if (isMultiTarget) {
      options.push({ type: 'separator' });
      options.push({
        label: `Copy ${state.selectedPaths.length} Paths`,
        icon: 'content_copy',
        action: () => handleCopyPaths(state.selectedPaths),
      });
      options.push({
        label: `Delete ${state.selectedPaths.length} Items`,
        icon: 'delete',
        action: () => handleDeleteSelection(state.selectedPaths),
        danger: true,
      });
      return options;
    }

    options.push({
      label: 'Copy',
      icon: 'content_copy',
      action: () => setClipboard({ path: node.path, isDirectory: node.isDirectory }),
    });
    options.push({
      label: 'Copy Absolute Path',
      icon: 'link',
      action: () => handleCopyPath(node.path),
    });
    options.push({
      label: revealInFileManagerLabel(),
      icon: 'folder_open',
      action: () => handleRevealInFileManager(node.path),
    });
    options.push({
      label: node.isDirectory ? 'Start Agent with Folder' : 'Start Agent with File',
      icon: 'bolt',
      action: () => {
        state.setInitialAgentTask(
          `Analyze and work with this ${node.isDirectory ? 'directory' : 'file'}: ${node.path}`
        );
        state.setSpawnDialogOpen(true);
      },
    });

    if (node.isDirectory && clipboard) {
      options.push({ label: 'Paste', icon: 'content_paste', action: () => handlePaste(node.path) });
    }

    if (!node.isDirectory && /\.(md|markdown)$/i.test(node.name)) {
      options.push({
        label: 'Show as Mindmap',
        icon: 'account_tree',
        action: () => {
          const tabId = `mindmap::${node.path}`;
          state.openTab({ id: tabId, path: node.path, name: `${node.name} · Mindmap` });
        },
      });
      options.push({
        label: 'Create Ticket from Markdown',
        icon: 'assignment_add',
        action: () => handleCreateTicketFromMarkdown(node),
      });
    }

    if (node.isDirectory) {
      options.push({
        label: 'Generate Diagram',
        icon: 'schema',
        action: () => state.setDiagramDialogFolder(node.path),
      });
      options.push({
        label: 'Open Terminal',
        icon: 'terminal',
        action: () => handleOpenTerminalHere(node.path),
      });
    }

    if (!isRootContext) {
      if (
        toGitignoreEntry(state.rootPath, node.path, node.isDirectory) &&
        node.name !== '.gitignore'
      ) {
        options.push({
          label: 'Add to .gitignore',
          icon: 'block',
          action: () => handleAddToGitignore(node),
        });
      }

      const ignoreableRepo = node.isDirectory
        ? state.repos.find((repo) => repo.path === node.path && repo.kind !== 'root')
        : undefined;
      if (ignoreableRepo) {
        options.push({
          label: 'Ignore this Git repository',
          icon: 'visibility_off',
          action: () => void handleIgnoreGitRepo(node.path),
        });
      }

      options.push({
        label: 'Rename',
        icon: 'edit',
        action: () => handleRenameRequest(node),
      });

      options.push({
        label: 'Delete',
        icon: 'delete',
        action: () => handleDeleteSelection([node.path]),
        danger: true,
      });
    }

    return options;
  }, [
    state,
    clipboard,
    setClipboard,
    handleCopyPath,
    handleCopyPaths,
    handleRevealInFileManager,
    handleDeleteSelection,
    handleRenameRequest,
    handlePaste,
    handleOpenTerminalHere,
    handleNewDiagram,
    handleCreateTicketFromMarkdown,
    handleAddToGitignore,
    handleIgnoreGitRepo,
  ]);

  return {
    handleContextMenu,
    handleRootContextMenu,
    contextMenuOptions,
  };
}
