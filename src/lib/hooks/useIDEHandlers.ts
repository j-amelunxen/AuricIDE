'use client';

import { useState, useMemo, useCallback, type MouseEvent } from 'react';
import { useStore } from '@/lib/store';
import { TIPS, activityItems } from '../ide/constants';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type FileNode } from '@/lib/store/fileTreeSlice';
import { serializeMindmap, type MindmapNode } from '@/lib/mindmap/mindmapParser';
import { type WorkflowNode, serializeWorkflow } from '@/lib/canvas/markdownParser';
import {
  readFile,
  readFileBase64,
  writeFile,
  openFolderDialog,
  readDirectory,
  type FileEntry,
} from '@/lib/tauri/fs';
import { type AgentConfig } from '@/lib/tauri/agents';
import { extractHeadings, getHeadingBreadcrumbs } from '@/lib/editor/markdownHeadingParser';
import { type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { defaultCommands } from '@/lib/commands/registry';
import { type useIDEState } from './useIDEState';

export function useIDEHandlers(state: ReturnType<typeof useIDEState>) {
  const [clipboard, setClipboard] = useState<{ path: string; isDirectory: boolean } | null>(null);

  const toFileTreeNodes = useCallback((nodes: FileNode[]): FileTreeNode[] => {
    return nodes.map((n) => ({
      ...n,
      children: n.children ? toFileTreeNodes(n.children) : undefined,
    }));
  }, []);

  const handleRefresh = useCallback(
    async (dir?: string, isRoot?: boolean): Promise<FileEntry[] | undefined> => {
      const path = dir || state.rootPath;
      if (!path) return;

      if (!dir || isRoot || dir === state.rootPath) {
        // Building the root tree — fetch entries and git status in parallel
        const [entries, statuses] = await Promise.all([
          readDirectory(path),
          useStore
            .getState()
            .refreshGitStatus(path)
            .then(() => useStore.getState().fileStatuses)
            .catch(() => []),
        ]);
        const tree: FileNode[] = entries.map((e) => {
          const relativePath = e.path.replace(path.endsWith('/') ? path : path + '/', '');
          const statusEntry = statuses.find((s) => s.path === relativePath);
          let gitStatus: FileNode['gitStatus'] = undefined;
          if (statusEntry) {
            if (statusEntry.status === 'untracked' || statusEntry.status === 'added')
              gitStatus = 'added';
            else if (statusEntry.status === 'modified') gitStatus = 'modified';
            else if (statusEntry.status === 'deleted') gitStatus = 'deleted';
            else if (statusEntry.status === 'ignored') gitStatus = 'ignored';
          }
          return {
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            expanded: false,
            children: e.isDirectory ? [] : undefined,
            gitStatus,
          };
        });
        state.setFileTree(tree);
        return entries;
      } else {
        const entries = await readDirectory(path);
        const children: FileNode[] = entries.map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.isDirectory,
          expanded: false,
          children: e.isDirectory ? [] : undefined,
        }));
        state.setDirectoryChildren(path, children);
        return entries;
      }
    },
    [state]
  );

  const handleCloseProject = useCallback(() => {
    state.closeProject();
    state.closeAllTabs();
    state.setProjectFiles([]);
    state.setEditorContent('');
    state.setImageData(null);
    state.setMindmapData(null);
    state.setDiffContent(null);
  }, [state]);

  const handleFileSelect = useCallback(
    async (path: string) => {
      state.selectFile(path);
      state.openTab({ id: path, path, name: path.split('/').pop() ?? path });

      const ext = path.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
        const data = await readFileBase64(path);
        // Guard: user may have switched tabs while the file was loading
        if (useStore.getState().activeTabId !== path) return;
        state.setImageData(data);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else {
        const content = await readFile(path);
        // Guard: user may have switched tabs while the file was loading
        if (useStore.getState().activeTabId !== path) return;
        state.setEditorContent(content);
        state.setImageData(null);
        if (path.endsWith('.mindmap.md')) {
          const { parseMindmapMarkdown } = await import('@/lib/mindmap/mindmapParser');
          state.setMindmapData(parseMindmapMarkdown(content));
        } else {
          state.setMindmapData(null);
        }
      }
      state.setDiffContent(null);
    },
    [state]
  );

  const handleToggleDir = useCallback(
    async (path: string) => {
      state.toggleExpand(path);
      const children = await readDirectory(path);
      state.setDirectoryChildren(path, children);
    },
    [state]
  );

  const handleNewFile = useCallback(async () => {
    if (!state.rootPath) return;
    const newPath = `${state.rootPath}/untitled-${Date.now()}.md`;
    await writeFile(newPath, '');
    await handleRefresh();
    handleFileSelect(newPath);
  }, [state, handleRefresh, handleFileSelect]);

  const openReadmeIfExists = useCallback(
    (entries: FileEntry[]) => {
      const readme = entries.find((e) => !e.isDirectory && /^readme\.(md|txt)$/i.test(e.name));
      if (readme) handleFileSelect(readme.path);
    },
    [handleFileSelect]
  );

  const handleOpenFolder = useCallback(async () => {
    const selected = await openFolderDialog();
    if (selected) {
      state.closeAllTabs();
      state.setRootPath(selected);
      state.addRecentProject(selected);
      state.initProjectDb(selected);
      const entries = await handleRefresh(selected, true);
      if (entries) openReadmeIfExists(entries);
    }
  }, [state, handleRefresh, openReadmeIfExists]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      state.closeAllTabs();
      state.setRootPath(path);
      state.addRecentProject(path);
      state.initProjectDb(path);
      const entries = await handleRefresh(path, true);
      if (entries) openReadmeIfExists(entries);
    },
    [state, handleRefresh, openReadmeIfExists]
  );

  const handleSave = useCallback(async () => {
    if (!state.activeTabId) return;
    await writeFile(state.activeTabId, state.editorContent);
    state.markDirty(state.activeTabId, false);
  }, [state]);

  const handleEditorChange = useCallback(
    (newContent: string) => {
      state.setEditorContent(newContent);
      state.markDirty(state.activeTabId!, true);
      if (state.activeTabId) {
        writeFile(state.activeTabId, newContent).then(() => {
          state.markDirty(state.activeTabId!, false);
          state.updateFileInIndex(state.activeTabId!, newContent);
        });
      }
    },
    [state]
  );

  const handleSelectionSpawn = useCallback(
    (selection: string) => {
      state.setInitialAgentTask(`Context Selection:\n${selection}\n\nTask: `);
      state.setSpawnDialogOpen(true);
    },
    [state]
  );

  const handleSpawnNewAgent = useCallback(
    async (config: AgentConfig) => {
      await state.spawnNewAgent(config);
      state.setSpawnDialogOpen(false);
      state.setBottomCollapsed(false);
    },
    [state]
  );

  const handleKillAgent = useCallback(
    (id: string) => {
      state.killRunningAgent(id);
    },
    [state]
  );

  const handleSelectAgent = useCallback(
    (id: string | null) => {
      state.selectAgent(id);
      if (id) {
        const agent = state.agents.find((a) => a.id === id);
        if (agent) state.setFullscreenAgent(agent);
      }
    },
    [state]
  );

  const handleImageDrop = useCallback((_agentId: string, _imageData: string) => {
    // Basic implementation placeholder
  }, []);

  const handleOpenTerminalHere = useCallback(
    (folderPath: string) => {
      const id = `term-${Date.now()}`;
      const label = folderPath.split('/').pop() || folderPath;
      state.setExtraTerminals((prev) => [...prev, { id, label, cwd: folderPath }]);
      state.setBottomCollapsed(false);
    },
    [state]
  );

  const handleCloseTerminal = useCallback(
    (id: string) => {
      state.setExtraTerminals((prev) => prev.filter((t) => t.id !== id));
    },
    [state]
  );

  const handleCanvasNodesChange = useCallback(
    (nodes: WorkflowNode[]) => {
      state.setCanvasData({ nodes, edges: state.canvasEdges });
      if (state.activeTabId) {
        const updated = serializeWorkflow({ nodes, edges: state.canvasEdges });
        writeFile(state.activeTabId, updated);
      }
    },
    [state]
  );

  const handleMindmapNodesChange = useCallback(
    (nodes: unknown[]) => {
      if (state.mindmapData) {
        const newData = { ...state.mindmapData, nodes: nodes as unknown as MindmapNode[] };
        state.setMindmapData(newData);
        if (state.activeTabId) {
          writeFile(state.activeTabId, serializeMindmap(newData));
        }
      }
    },
    [state]
  );

  const handleMindmapNodeEdit = useCallback(
    (id: string, text: string) => {
      if (state.mindmapData) {
        const nodes = state.mindmapData.nodes.map((n) =>
          n.id === id ? { ...n, content: text } : n
        );
        handleMindmapNodesChange(nodes);
      }
    },
    [state, handleMindmapNodesChange]
  );

  const handleCommit = useCallback(async () => {
    if (!state.rootPath) return;
    await state.commitChanges(state.rootPath);
    state.setCommitMessage('');
    handleRefresh();
  }, [state, handleRefresh]);

  const handleDiscardFile = useCallback(
    async (filePath: string) => {
      if (!state.rootPath) return;
      const { discardChanges } = await import('@/lib/tauri/git');
      await discardChanges(state.rootPath, filePath);
      handleRefresh();
      const fullPath = `${state.rootPath}/${filePath}`;
      if (state.activeTabId === fullPath) state.closeTab(fullPath);
    },
    [state, handleRefresh]
  );

  const handleDiffFileClick = useCallback(
    async (path: string) => {
      if (!state.rootPath) return;
      const { getGitDiff } = await import('@/lib/tauri/git');
      const diff = await getGitDiff(state.rootPath, path);
      state.setDiffContent(diff);
      state.openTab({ id: `diff:${path}`, path, name: `${path.split('/').pop()} (diff)` });
      state.setActiveTab(`diff:${path}`);
    },
    [state]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, node: FileTreeNode) => {
      e.preventDefault();
      state.setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [state]
  );

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  const handleDelete = useCallback(
    async (node: FileTreeNode) => {
      if (confirm(`Are you sure you want to delete ${node.name}?`)) {
        const { deleteFile } = await import('@/lib/tauri/fs');
        await deleteFile(node.path);
        handleRefresh();
      }
    },
    [handleRefresh]
  );

  const handlePaste = useCallback(
    async (targetDir: string) => {
      if (!clipboard) return;
      const { copyFile } = await import('@/lib/tauri/fs');
      const fileName = clipboard.path.split('/').pop();
      const dest = `${targetDir}/${fileName}_copy`;
      await copyFile(clipboard.path, dest);
      handleRefresh();
    },
    [clipboard, handleRefresh]
  );

  const handleCreateNewItem = useCallback(
    async (name: string) => {
      if (!state.newItemModal) return;
      const fullPath = `${state.newItemModal.parentDir}/${name}`;
      if (state.newItemModal.type === 'folder') {
        const { createDirectory } = await import('@/lib/tauri/fs');
        await createDirectory(fullPath);
      } else {
        await writeFile(fullPath, '');
      }
      handleRefresh(state.newItemModal.parentDir);
      state.setNewItemModal(null);
    },
    [state, handleRefresh]
  );

  const handleActivitySelect = useCallback(
    (id: string) => {
      if (id === 'project-mgmt') {
        state.setPmModalOpen(true);
        if (state.rootPath) state.loadPmData(state.rootPath);
        return;
      }
      if (id === 'settings') {
        state.setSettingsModalOpen(true);
        return;
      }
      if (id === 'graph') {
        state.setLinkGraphModalOpen(true);
        return;
      }
      if (id === 'blueprints') {
        state.setBlueprintsGalleryOpen(true);
        if (state.rootPath) state.loadBlueprints(state.rootPath);
        return;
      }
      state.setActiveActivity(id);
    },
    [state]
  );

  const handleWikiLinkNavigate = useCallback(
    (target: string) => {
      const allPaths = useStore.getState().allFilePaths;
      const match = allPaths.find(
        (p) =>
          p.toLowerCase().endsWith('/' + target.toLowerCase()) ||
          p.toLowerCase().endsWith('\\' + target.toLowerCase())
      );
      if (match) state.selectFile(match);
    },
    [state]
  );

  const handleProblemsClick = useCallback(() => {
    state.setBottomCollapsed(false);
    state.setBottomTab('problems');
    state.setProblemsPanelOpen(true);
  }, [state]);

  // Context menu options
  const contextMenuOptions = useMemo<ContextMenuOption[]>(() => {
    if (!state.contextMenu) return [];
    const { node } = state.contextMenu;
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
        label: 'Copy',
        icon: 'content_copy',
        action: () => setClipboard({ path: node.path, isDirectory: node.isDirectory }),
      },
      { label: 'Copy Absolute Path', icon: 'link', action: () => handleCopyPath(node.path) },
      {
        label: node.isDirectory ? 'Start Agent with Folder' : 'Start Agent with File',
        icon: 'bolt',
        action: () => {
          state.setInitialAgentTask(
            `Analyze and work with this ${node.isDirectory ? 'directory' : 'file'}: ${node.path}`
          );
          state.setSpawnDialogOpen(true);
        },
      },
    ];

    if (node.isDirectory && clipboard) {
      options.push({ label: 'Paste', icon: 'content_paste', action: () => handlePaste(node.path) });
    }

    if (!node.isDirectory && /\.(md|markdown)$/i.test(node.name)) {
      options.push({
        label: 'Show as Mindmap',
        icon: 'account_tree',
        action: () => {
          const tabId = `mindmap::${node.path}`;
          state.openTab({ id: tabId, path: node.path, name: `${node.name} — Mindmap` });
        },
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

    options.push({
      label: 'Delete',
      icon: 'delete',
      action: () => handleDelete(node),
      danger: true,
    });

    return options;
  }, [state, clipboard, handleCopyPath, handleDelete, handlePaste, handleOpenTerminalHere]);

  // Command palette
  const commandActions = useMemo<Record<string, () => void>>(
    () => ({
      'file.new': handleNewFile,
      'file.open-folder': handleOpenFolder,
      'file.search': () => state.setFileSearchOpen(true),
      'file.advanced-selection': () => state.setFileSelectorOpen(true),
      'file.save': handleSave,
      'file.import-spec': () => state.setImportSpecDialogOpen(true),
      'git.commit': handleCommit,
      'git.show-changes': () => state.setActiveActivity('source-control'),
      'agent.deploy': () => state.setSpawnDialogOpen(true),
      'agent.ascii-art': () => {
        state.setInitialAgentTask('Create an ASCII art representation of a futuristic AI logo.');
        state.setSpawnDialogOpen(true);
      },
      'view.toggle-sidebar': () =>
        document.querySelector<HTMLButtonElement>('[data-testid="toggle-left-panel"]')?.click(),
      'view.toggle-terminal': () =>
        document.querySelector<HTMLButtonElement>('[data-testid="toggle-bottom-panel"]')?.click(),
      'view.focus-explorer': () => state.setActiveActivity('explorer'),
      'view.focus-source-control': () => state.setActiveActivity('source-control'),
      'view.link-graph': () => state.setLinkGraphModalOpen(true),
    }),
    [state, handleNewFile, handleOpenFolder, handleSave, handleCommit]
  );

  const commands = useMemo(
    () => defaultCommands.map((cmd) => ({ ...cmd, action: commandActions[cmd.id] ?? (() => {}) })),
    [commandActions]
  );

  const handleCommandExecute = useCallback(
    (commandId: string) => {
      commands.find((c) => c.id === commandId)?.action();
      state.setCommandPaletteOpen(false);
    },
    [commands, state]
  );

  // UI calculations
  const scBadge = state.fileStatuses.filter((s) => s.status !== 'ignored').length;
  const openTicketsCount = useMemo(
    () => state.pmDraftTickets.filter((t) => t.status !== 'done').length,
    [state.pmDraftTickets]
  );
  const itemsWithBadge = useMemo(
    () =>
      activityItems.map((item) => {
        if (item.id === 'source-control')
          return { ...item, badge: scBadge > 0 ? scBadge : undefined };
        if (item.id === 'project-mgmt')
          return { ...item, badge: openTicketsCount > 0 ? openTicketsCount : undefined };
        return item;
      }),
    [scBadge, openTicketsCount]
  );

  const dailyTip = useMemo(() => {
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
    );
    return TIPS[dayOfYear % TIPS.length];
  }, []);

  const breadcrumbs = useMemo(() => {
    if (!state.activeTabId) return ['AuricIDE'];
    return ['AuricIDE', ...state.activeTabId.split('/').filter(Boolean)];
  }, [state.activeTabId]);

  const isMarkdownFile = useMemo(
    () => !!state.activeTabId && /\.(md|markdown)$/i.test(state.activeTabId),
    [state.activeTabId]
  );
  const headingBreadcrumbs = useMemo(() => {
    if (!isMarkdownFile) return [];
    const headings = extractHeadings(state.editorContent);
    return getHeadingBreadcrumbs(headings, state.cursorPos.line);
  }, [isMarkdownFile, state.editorContent, state.cursorPos.line]);

  const activeDiagCounts = useMemo(() => {
    if (!state.activeTabId) return { errors: 0, warnings: 0 };
    return state.getDiagnosticCounts(state.activeTabId);
  }, [state]);

  const activeDiagnostics = useMemo(() => {
    if (!state.activeTabId) return [];
    return state.diagnostics.get(state.activeTabId) ?? [];
  }, [state.activeTabId, state.diagnostics]);

  const activeLanguage = useMemo(() => {
    if (!state.activeTabId) return 'Markdown';
    const ext = state.activeTabId.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md':
      case 'markdown':
        return 'Markdown';
      case 'rs':
        return 'Rust';
      case 'js':
      case 'jsx':
        return 'JavaScript';
      case 'ts':
      case 'tsx':
        return 'TypeScript';
      case 'json':
        return 'JSON';
      case 'html':
        return 'HTML';
      case 'css':
        return 'CSS';
      default:
        return 'Plain Text';
    }
  }, [state.activeTabId]);

  const isDiffTab = !!state.activeTabId?.startsWith('diff:');
  const diffFilePath = isDiffTab ? state.activeTabId?.replace('diff:', '') : null;
  const isWorkflowFile = !!state.activeTabId?.endsWith('.workflow.md');
  const isMindmapTab = !!state.activeTabId?.endsWith('.mindmap.md');

  return {
    toFileTreeNodes,
    handleRefresh,
    handleCloseProject,
    handleFileSelect,
    handleToggleDir,
    handleNewFile,
    handleOpenFolder,
    handleOpenRecent,
    handleSave,
    handleEditorChange,
    handleSelectionSpawn,
    handleSpawnNewAgent,
    handleKillAgent,
    handleSelectAgent,
    handleImageDrop,
    handleOpenTerminalHere,
    handleCloseTerminal,
    handleCanvasNodesChange,
    handleMindmapNodesChange,
    handleMindmapNodeEdit,
    handleCommit,
    handleDiscardFile,
    handleDiffFileClick,
    handleContextMenu,
    handleCopyPath,
    handleDelete,
    handlePaste,
    handleCreateNewItem,
    handleActivitySelect,
    handleWikiLinkNavigate,
    handleProblemsClick,
    contextMenuOptions,
    commands,
    handleCommandExecute,
    itemsWithBadge,
    dailyTip,
    breadcrumbs,
    headingBreadcrumbs,
    activeDiagCounts,
    activeDiagnostics,
    activeLanguage,
    isDiffTab,
    diffFilePath,
    isWorkflowFile,
    isMindmapTab,
  };
}
