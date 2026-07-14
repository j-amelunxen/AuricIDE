'use client';

import { useState, useMemo, useCallback, type MouseEvent } from 'react';
import { useStore } from '@/lib/store';
import { TIPS, activityItems } from '../ide/constants';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type FileNode } from '@/lib/store/fileTreeSlice';
import { serializeMindmap, type MindmapNode } from '@/lib/mindmap/mindmapParser';
import { type WorkflowNode, serializeWorkflow } from '@/lib/canvas/markdownParser';
import { serializeObsidianCanvas } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianNode, ObsidianEdge, ObsidianColor } from '@/lib/obsidian-canvas/types';
import type { PmTicket, PmDependency } from '@/lib/tauri/pm';
import {
  readFile,
  readFileBase64,
  writeFile,
  openFolderDialog,
  readDirectory,
  createDirectory,
  listAllFiles,
  movePath,
  type FileEntry,
} from '@/lib/tauri/fs';
import {
  joinProjectPath,
  scaffoldProjectFiles,
  type NewProjectOptions,
} from '@/lib/project/newProject';
import { type AgentConfig } from '@/lib/tauri/agents';
import { revealInFileManager } from '@/lib/tauri/opener';
import { extractTicket } from '@/lib/git/branchTicket';
import { extractHeadings, getHeadingBreadcrumbs } from '@/lib/editor/markdownHeadingParser';
import { emptyExcalidrawSceneJson } from '@/lib/excalidraw/serialize';
import { type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { defaultCommands } from '@/lib/commands/registry';
import { type useIDEState } from './useIDEState';

/** Label matches each OS's own file manager, following VS Code's convention. */
function revealInFileManagerLabel(): string {
  if (typeof window === 'undefined') return 'Reveal in File Manager';
  const platform = window.navigator.platform;
  if (platform.includes('Mac')) return 'Reveal in Finder';
  if (platform.includes('Win')) return 'Reveal in File Explorer';
  return 'Show in File Manager';
}

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
        // Building the root tree — fetch entries, git status and the flat file
        // list in parallel. The flat list feeds Mission Control's spec count
        // and wiki-link resolution, so it must follow filesystem changes too.
        const [entries, statuses, allFiles] = await Promise.all([
          readDirectory(path),
          useStore
            .getState()
            .refreshGitStatus(path)
            .then(() => useStore.getState().fileStatuses)
            .catch(() => []),
          listAllFiles(path).catch(() => null),
        ]);
        if (allFiles) state.setAllFiles(allFiles);
        const currentTree = useStore.getState().fileTree ?? [];
        const existingByPath = new Map<string, FileNode>(currentTree.map((n) => [n.path, n]));
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
          const existing = existingByPath.get(e.path);
          return {
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            expanded: existing?.expanded ?? false,
            children: existing?.children ?? (e.isDirectory ? [] : undefined),
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
    state.clearLinkIndex();
    state.clearHeadingIndex();
    state.clearEntityIndex();
    state.resetPmInMemory();
    state.resetBlueprintsInMemory();
    state.resetRequirementsInMemory();
    state.resetExcalidrawInMemory();
    state.setProjectFiles([]);
    state.setEditorContent('');
    state.setImageData(null);
    state.setPdfData(null);
    state.setMindmapData(null);
    state.setDiffContent(null);
  }, [state]);

  // Loads a tab's file into the viewer states (editor / image / pdf / mindmap /
  // canvas). Driven by the activeTabId effect in useIDEActions — the single
  // owner of content loading, so tab clicks and tab closes update the view
  // exactly like tree clicks do.
  const loadTabContent = useCallback(
    async (path: string) => {
      const ext = path.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
        const data = await readFileBase64(path);
        // Guard: user may have switched tabs while the file was loading
        if (useStore.getState().activeTabId !== path) return;
        state.setImageData(data);
        state.setPdfData(null);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else if (ext === 'pdf') {
        const data = await readFileBase64(path);
        // Guard: user may have switched tabs while the file was loading
        if (useStore.getState().activeTabId !== path) return;
        state.setPdfData(data);
        state.setImageData(null);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else {
        const content = await readFile(path);
        // Guard: user may have switched tabs while the file was loading
        if (useStore.getState().activeTabId !== path) return;
        state.setEditorContent(content);
        state.setImageData(null);
        state.setPdfData(null);
        if (path.endsWith('.mindmap.md')) {
          const { parseMindmapMarkdown } = await import('@/lib/mindmap/mindmapParser');
          state.setMindmapData(parseMindmapMarkdown(content));
        } else {
          state.setMindmapData(null);
        }
        if (path.endsWith('.canvas')) {
          const { parseObsidianCanvas } = await import('@/lib/obsidian-canvas/canvasParser');
          state.setObsidianCanvasData(parseObsidianCanvas(content));
        }
      }
      state.setDiffContent(null);
    },
    [state]
  );

  const handleFileSelect = useCallback(
    async (path: string) => {
      state.selectFile(path);
      // Activating the tab is all it takes — the activeTabId effect loads the
      // content (and skips redundant reloads when the tab is already active).
      state.openTab({ id: path, path, name: path.split('/').pop() ?? path });
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

  const handleNewSpec = useCallback(async () => {
    if (!state.rootPath) return;
    const specsDir = `${state.rootPath}/specs`;
    await createDirectory(specsDir);
    const newPath = `${specsDir}/spec-${Date.now()}.md`;
    await writeFile(
      newPath,
      '# New Spec\n\n## Context\n\nWhat problem does this solve, and for whom?\n\n## Requirements\n\n-\n\n## Acceptance Criteria\n\n- [ ]\n'
    );
    await handleRefresh();
    handleFileSelect(newPath);
  }, [state, handleRefresh, handleFileSelect]);

  const handleNewDiagram = useCallback(
    async (parentDir?: string) => {
      if (!state.rootPath) return;
      const dir = parentDir ?? state.rootPath;
      const newPath = `${dir}/untitled-diagram-${Date.now()}.excalidraw`;
      await writeFile(newPath, emptyExcalidrawSceneJson());
      await handleRefresh(parentDir);
      handleFileSelect(newPath);
    },
    [state, handleRefresh, handleFileSelect]
  );

  const handleMoveNode = useCallback(
    async (sourcePath: string, destDir: string) => {
      const name = sourcePath.split('/').pop();
      if (!name) return;
      const destination = `${destDir}/${name}`;
      if (destination === sourcePath) return;
      try {
        await movePath(sourcePath, destination);
      } catch (err) {
        // Collision / illegal move — surface it and leave the tree untouched.
        const message = typeof err === 'string' ? err : `Could not move "${name}"`;
        state.showToast(message, 'error');
        return;
      }
      // Keep open tabs and the selection pointing at the moved item.
      state.renamePath(sourcePath, destination);
      if (state.selectedPath === sourcePath || state.selectedPath?.startsWith(sourcePath + '/')) {
        state.selectFile(state.selectedPath.replace(sourcePath, destination));
      }
      await handleRefresh();
    },
    [state, handleRefresh]
  );

  // Mission Control is the home surface: no document steals focus on project
  // open, but the cockpit needs its numbers (tickets, invariants, goals) live.
  const loadProjectData = useCallback(
    (projectPath: string) => {
      void state.loadPmData(projectPath);
      void state.loadRequirements(projectPath);
      void state.loadGoals(projectPath);
      void state.loadExcalidrawSpecLinks(projectPath);
    },
    [state]
  );

  const clearProjectState = useCallback(() => {
    state.closeAllTabs();
    state.setFileTree([]);
    state.clearLinkIndex();
    state.clearHeadingIndex();
    state.clearEntityIndex();
    state.resetPmInMemory();
    state.resetBlueprintsInMemory();
    state.resetRequirementsInMemory();
    state.resetExcalidrawInMemory();
    state.setProjectFiles([]);
    state.setEditorContent('');
    state.setImageData(null);
    state.setPdfData(null);
    state.setMindmapData(null);
    state.setDiffContent(null);
  }, [state]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await openFolderDialog();
    if (!selected) return;
    clearProjectState();
    state.setRootPath(selected);
    state.addRecentProject(selected);
    state.initProjectDb(selected);
    loadProjectData(selected);
    await handleRefresh(selected, true);
  }, [state, clearProjectState, handleRefresh, loadProjectData]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      clearProjectState();
      state.setRootPath(path);
      state.addRecentProject(path);
      state.initProjectDb(path);
      loadProjectData(path);
      await handleRefresh(path, true);
    },
    [state, clearProjectState, handleRefresh, loadProjectData]
  );

  const handleNewProject = useCallback(
    async ({ name, parentDir, template }: NewProjectOptions) => {
      const projectDir = joinProjectPath(parentDir, name);
      const files = scaffoldProjectFiles(projectDir, name, template);
      // Create the project directory (recursive) before writing scaffold files.
      await createDirectory(projectDir);
      for (const file of files) {
        // Ensure the file's parent directory exists (templates may nest).
        const parent = file.path.replace(/[\\/][^\\/]+$/, '');
        if (parent && parent !== projectDir) await createDirectory(parent);
        await writeFile(file.path, file.content);
      }
      clearProjectState();
      state.setRootPath(projectDir);
      state.addRecentProject(projectDir);
      state.initProjectDb(projectDir);
      loadProjectData(projectDir);
      await handleRefresh(projectDir, true);
    },
    [state, clearProjectState, handleRefresh, loadProjectData]
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
      // Spawning against a goal recorded a goal run — persist it immediately
      // so it isn't lost if the user closes the Goals modal without saving.
      if (config.spawnedByGoalId && state.rootPath) {
        await useStore.getState().saveGoals(state.rootPath);
      }
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

  const handleOcNodesChange = useCallback((nodes: ObsidianNode[]) => {
    const { ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    setObsidianCanvasData({ nodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes, edges: ocEdges }));
    }
  }, []);

  const handleOcEdgesChange = useCallback((edges: ObsidianEdge[]) => {
    const { ocNodes, activeTabId, setObsidianCanvasData } = useStore.getState();
    setObsidianCanvasData({ nodes: ocNodes, edges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: ocNodes, edges }));
    }
  }, []);

  const handleOcTextEdit = useCallback((id: string, newText: string) => {
    const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    const updatedNodes = ocNodes.map((n) =>
      n.id === id && n.type === 'text' ? { ...n, text: newText } : n
    );
    setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
    }
  }, []);

  const loadFileContent = useCallback(
    async (relativePath: string) => {
      if (!state.rootPath) throw new Error('No project root');
      return readFile(`${state.rootPath}/${relativePath}`);
    },
    [state.rootPath]
  );

  const handleOcFileOpen = useCallback(
    (relativePath: string) => {
      if (!state.rootPath) return;
      handleFileSelect(`${state.rootPath}/${relativePath}`);
    },
    [state.rootPath, handleFileSelect]
  );

  const handleOcFileDrop = useCallback(
    (absolutePath: string, position: { x: number; y: number }) => {
      const { rootPath, ocNodes, ocEdges, activeTabId, setObsidianCanvasData } =
        useStore.getState();
      const relativePath = rootPath
        ? absolutePath.replace(rootPath.replace(/\/$/, '') + '/', '')
        : absolutePath;
      const newNode: ObsidianNode = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'file' as const,
        file: relativePath,
        x: position.x,
        y: position.y,
        width: 400,
        height: 300,
      };
      const updatedNodes = [...ocNodes, newNode];
      setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
      if (activeTabId) {
        writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
      }
    },
    []
  );

  const handleOcResize = useCallback((id: string, width: number, height: number) => {
    const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData } = useStore.getState();
    const updatedNodes = ocNodes.map((n) => (n.id === id ? { ...n, width, height } : n));
    setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
    if (activeTabId) {
      writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
    }
  }, []);

  const handleOcNodeContextMenu = useCallback((event: React.MouseEvent, node: { id: string }) => {
    event.preventDefault();
    useStore
      .getState()
      .setCanvasContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const handleOcNodeColorChange = useCallback(
    (nodeId: string, color: ObsidianColor | undefined) => {
      const { ocNodes, ocEdges, activeTabId, setObsidianCanvasData, setCanvasContextMenu } =
        useStore.getState();
      const updatedNodes = ocNodes.map((n) => (n.id === nodeId ? { ...n, color } : n));
      setObsidianCanvasData({ nodes: updatedNodes, edges: ocEdges });
      if (activeTabId) {
        writeFile(activeTabId, serializeObsidianCanvas({ nodes: updatedNodes, edges: ocEdges }));
      }
      setCanvasContextMenu(null);
    },
    []
  );

  const handleCreateTicketFromNode = useCallback((nodeId: string) => {
    const store = useStore.getState();
    const node = store.ocNodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== 'text' && node.type !== 'file')) return;

    store.setCanvasContextMenu(null);

    let name = '';
    let description = '';
    if (node.type === 'text') {
      const lines = node.text.split('\n');
      name = lines[0]?.replace(/^#+\s*/, '').trim() ?? '';
      description = lines.slice(1).join('\n').trim();
    } else if (node.type === 'file') {
      name =
        node.file
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '') ?? '';
      description = `From canvas file node: ${node.file}`;
    }

    const canvasRelPath =
      store.activeTabId && store.rootPath
        ? store.activeTabId.replace(store.rootPath.replace(/\/$/, '') + '/', '')
        : (store.activeTabId ?? '');

    store.setCanvasTicketCreate({
      nodeId,
      initialValues: {
        name,
        description,
        context: [
          { id: crypto.randomUUID(), type: 'canvas-node', value: `${canvasRelPath}#${nodeId}` },
          { id: crypto.randomUUID(), type: 'file', value: canvasRelPath },
        ],
      },
    });
  }, []);

  const persistNewTicket = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      const now = new Date().toISOString();
      const store = useStore.getState();

      store.addTicket({
        ...ticketData,
        statusUpdatedAt: now,
        sortOrder: store.pmDraftTickets.length,
        createdAt: now,
        updatedAt: now,
      });
      dependencies.forEach((dep) => store.addDependency(dep));

      if (store.rootPath) store.savePmData(store.rootPath);
    },
    []
  );

  const handleCanvasTicketSave = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      persistNewTicket(ticketData, dependencies);

      const store = useStore.getState();
      const { canvasTicketCreate, activeTabId } = store;
      if (canvasTicketCreate?.nodeId) {
        const updatedNodes = store.ocNodes.map((n) =>
          n.id === canvasTicketCreate.nodeId ? { ...n, auricTicketId: ticketData.id } : n
        );
        store.setObsidianCanvasData({ nodes: updatedNodes, edges: store.ocEdges });
        if (activeTabId) {
          writeFile(
            activeTabId,
            serializeObsidianCanvas({ nodes: updatedNodes, edges: store.ocEdges })
          );
        }
      }
    },
    [persistNewTicket]
  );

  const handleFileTicketSave = useCallback(
    (
      ticketData: Omit<PmTicket, 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'sortOrder'>,
      dependencies: PmDependency[]
    ) => {
      persistNewTicket(ticketData, dependencies);
    },
    [persistNewTicket]
  );

  const handleCreateTicketFromMarkdown = useCallback(
    async (node: FileTreeNode) => {
      const content = await readFile(node.path);
      const firstHeading = content.match(/^#+\s*(.+)$/m)?.[1]?.trim();
      const fallbackName = node.name.replace(/\.(md|markdown)$/i, '');
      state.setFileTicketCreate({
        initialValues: {
          name: firstHeading || fallbackName,
          description: content,
          context: [{ id: crypto.randomUUID(), type: 'file', value: node.path }],
        },
      });
    },
    [state]
  );

  const handleTicketBadgeClick = useCallback((ticketId: string) => {
    const store = useStore.getState();
    const ticket = store.pmDraftTickets.find((t) => t.id === ticketId);
    if (!ticket) return;

    store.setPmSelectedEpicId(ticket.epicId);
    store.setPmSelectedTicketId(ticket.id);
    store.setPmModalOpen(true);
  }, []);

  const handleCommit = useCallback(async () => {
    if (!state.rootPath) return;

    if (state.agentSettings.agenticCommit) {
      const providerId = state.agentSettings.commitProviderId || state.defaultProvider.id;
      const provider =
        state.providers.find((p) => p.id === providerId) ??
        state.providers[0] ??
        state.defaultProvider;
      const ticketPrefix =
        extractTicket(state.branchInfo?.name ?? '', state.agentSettings.branchTicketPattern) ?? '';
      const task = state.agentSettings.agenticCommitPrompt.replaceAll('{ticket}', ticketPrefix);

      await state.spawnNewAgent({
        name: `commit:${state.rootPath.split('/').pop() ?? 'repo'}`,
        model: provider.defaultModel,
        provider: provider.id,
        task,
        cwd: state.rootPath,
      });
      state.setCommitMessage('');
      return;
    }

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

  const handleRevealInFileManager = useCallback((path: string) => {
    revealInFileManager(path);
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
        // .excalidraw files must be born as a parseable empty scene — a
        // zero-byte file only ever renders the "not a valid scene" panel.
        const seed = name.endsWith('.excalidraw') ? emptyExcalidrawSceneJson() : '';
        await writeFile(fullPath, seed);
      }
      handleRefresh(state.newItemModal.parentDir);
      state.setNewItemModal(null);
    },
    [state, handleRefresh]
  );

  const handleActivitySelect = useCallback(
    (id: string) => {
      if (id === 'cockpit') {
        // Home: clear document focus so Mission Control takes the center.
        state.setActiveTab(null);
        state.setActiveActivity('cockpit');
        return;
      }
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
      if (id === 'requirements') {
        state.setRequirementsModalOpen(true);
        if (state.rootPath) state.loadRequirements(state.rootPath);
        return;
      }
      if (id === 'goals') {
        useStore.getState().setGoalsModalOpen(true);
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
        label: 'New Diagram',
        icon: 'draw',
        action: () => handleNewDiagram(parentDir),
      },
      {
        label: 'Copy',
        icon: 'content_copy',
        action: () => setClipboard({ path: node.path, isDirectory: node.isDirectory }),
      },
      { label: 'Copy Absolute Path', icon: 'link', action: () => handleCopyPath(node.path) },
      {
        label: revealInFileManagerLabel(),
        icon: 'folder_open',
        action: () => handleRevealInFileManager(node.path),
      },
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

    options.push({
      label: 'Delete',
      icon: 'delete',
      action: () => handleDelete(node),
      danger: true,
    });

    return options;
  }, [
    state,
    clipboard,
    handleCopyPath,
    handleRevealInFileManager,
    handleDelete,
    handlePaste,
    handleOpenTerminalHere,
    handleNewDiagram,
    handleCreateTicketFromMarkdown,
  ]);

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
      'view.cockpit': () => {
        state.setActiveTab(null);
        state.setActiveActivity('cockpit');
      },
      'view.goals': () => useStore.getState().setGoalsModalOpen(true),
      'excalidraw.new': () => void handleNewDiagram(),
      'excalidraw.browse': () => useStore.getState().setExcalidrawBrowserOpen(true),
      'excalidraw.sync-all': () => {
        const store = useStore.getState();
        if (!store.rootPath) return;
        void store.resyncAllSpecs(store.rootPath).then(({ synced, failed }) => {
          useStore
            .getState()
            .showToast(
              `Excalidraw+ specs: ${synced} synced${failed > 0 ? `, ${failed} failed` : ''}`,
              failed > 0 ? 'error' : 'success'
            );
        });
      },
    }),
    [state, handleNewFile, handleNewDiagram, handleOpenFolder, handleSave, handleCommit]
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
    () => state.pmDraftTickets.filter((t) => t.status !== 'done' && t.status !== 'archived').length,
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
  const isObsidianCanvas = !!state.activeTabId?.endsWith('.canvas');
  const isExcalidrawTab = !!state.activeTabId?.endsWith('.excalidraw');
  const isHtmlTab = /\.html?$/i.test(state.activeTabId ?? '');

  return {
    toFileTreeNodes,
    handleRefresh,
    handleCloseProject,
    loadTabContent,
    handleFileSelect,
    handleToggleDir,
    handleNewFile,
    handleNewSpec,
    handleNewDiagram,
    handleMoveNode,
    handleOpenFolder,
    handleOpenRecent,
    handleNewProject,
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
    handleOcNodesChange,
    handleOcEdgesChange,
    handleOcTextEdit,
    handleOcResize,
    loadFileContent,
    handleOcFileOpen,
    handleOcFileDrop,
    handleOcNodeContextMenu,
    handleOcNodeColorChange,
    handleCreateTicketFromNode,
    handleCanvasTicketSave,
    handleFileTicketSave,
    handleCreateTicketFromMarkdown,
    handleTicketBadgeClick,
    isDiffTab,
    diffFilePath,
    isWorkflowFile,
    isMindmapTab,
    isObsidianCanvas,
    isExcalidrawTab,
    isHtmlTab,
  };
}
