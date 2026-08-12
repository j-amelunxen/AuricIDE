'use client';

import { useState, useMemo, useCallback, useEffect, type MouseEvent } from 'react';
import { useStore } from '@/lib/store';
import { createAutosave } from '@/lib/editor/autosave';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { TIPS, activityItems } from '../ide/constants';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import { type FileNode } from '@/lib/store/fileTreeSlice';
import type { GitFileStatus } from '@/lib/tauri/git';
import { serializeMindmap, type MindmapNode } from '@/lib/mindmap/mindmapParser';
import { type WorkflowNode, serializeWorkflow } from '@/lib/canvas/markdownParser';
import { serializeObsidianCanvas } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianNode, ObsidianEdge, ObsidianColor } from '@/lib/obsidian-canvas/types';
import type { PmTicket, PmDependency } from '@/lib/tauri/pm';
import {
  exists,
  readFile,
  readFileBase64,
  writeFile,
  openFolderDialog,
  readDirectory,
  createDirectory,
  deleteFile,
  listAllFiles,
  movePath,
  type FileEntry,
} from '@/lib/tauri/fs';
import { nextScratchName } from '@/lib/scratch/naming';
import { appendGitignoreEntry, toGitignoreEntry } from '@/lib/git/gitignore';
import { newItemParentDir } from '@/lib/explorer/newItemTarget';
import {
  joinProjectPath,
  scaffoldProjectFiles,
  type NewProjectOptions,
} from '@/lib/project/newProject';
import { type AgentConfig } from '@/lib/tauri/agents';
import { revealInFileManager } from '@/lib/tauri/opener';
import { extractTicket } from '@/lib/git/branchTicket';
import { computeBacklinkWarning } from '@/lib/refactoring/backlinkWarning';
import { computeFileRenameChanges } from '@/lib/refactoring/renameFile';
import { applyChangesToContent } from '@/lib/refactoring/applyRenameChanges';
import { extractHeadings, getHeadingBreadcrumbs } from '@/lib/editor/markdownHeadingParser';
import { emptyExcalidrawSceneJson } from '@/lib/excalidraw/serialize';
import { type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { defaultCommands } from '@/lib/commands/registry';
import { type useIDEState } from './useIDEState';
import { persistInBackground, persistQuietly } from '@/lib/store/persistFeedback';

/** Label matches each OS's own file manager, following VS Code's convention. */
function revealInFileManagerLabel(): string {
  if (typeof window === 'undefined') return 'Reveal in File Manager';
  const platform = window.navigator.platform;
  if (platform.includes('Mac')) return 'Reveal in Finder';
  if (platform.includes('Win')) return 'Reveal in File Explorer';
  return 'Show in File Manager';
}

/**
 * Commands that belong to a focused surface rather than to the application.
 * The palette can name them — that is how a user discovers the shortcut — but
 * it cannot perform them, because the editor and the canvas own the selection
 * they act on.
 *
 * They get an honest refusal instead of a shrug. A command that quietly does
 * nothing is worse than one that says where it lives: the palette closes, the
 * menu item flashes, and an external driver reads it as success.
 */
export const CONTEXT_BOUND_COMMANDS: Record<string, string> = {
  'agent.kill-all': 'Kill All lives in the Agents panel, per repository. It asks before it acts.',
  'canvas.toggle': 'Open a canvas file first; this switches the view of the active canvas.',
  'canvas.fit': 'Open a canvas file first; this fits the active canvas to the screen.',
  'markdown.rename-heading': 'Put the cursor on a heading in the editor, then press F2.',
  'markdown.find-references': 'Put the cursor on an entity in the editor, then press Alt+F7.',
  'markdown.extract-section': 'Put the cursor in the section you want to extract, in the editor.',
};

/** Maps a git-status entry's raw status string onto the tree's narrower badge set. */
function resolveGitStatus(relativePath: string, statuses: GitFileStatus[]): FileNode['gitStatus'] {
  const entry = statuses.find((s) => s.path === relativePath);
  if (!entry) return undefined;
  if (entry.status === 'untracked' || entry.status === 'added') return 'added';
  if (entry.status === 'modified') return 'modified';
  if (entry.status === 'deleted') return 'deleted';
  if (entry.status === 'ignored') return 'ignored';
  return undefined;
}

function relativeToRoot(path: string, rootPath: string): string {
  const root = rootPath.endsWith('/') ? rootPath : rootPath + '/';
  return path.replace(root, '');
}

function contextBoundAction(id: string): () => void {
  const hint = CONTEXT_BOUND_COMMANDS[id];
  if (!hint) {
    // Not wired and not declared context-bound. Guarded by a test, so this is
    // a developer mistake, not a user-facing state — say so rather than hide it.
    return () => useStore.getState().showToast(`Command "${id}" has no action.`, 'error');
  }
  return () => useStore.getState().showToast(hint, 'info');
}

/**
 * Widens the tree nodes the watcher returns into the shape the panel renders.
 * Module scope on purpose: it closes over nothing, and a recursive function
 * cannot refer to itself from inside its own declaration.
 */
function toFileTreeNodes(nodes: FileNode[]): FileTreeNode[] {
  return nodes.map((n) => ({
    ...n,
    children: n.children ? toFileTreeNodes(n.children) : undefined,
  }));
}

/**
 * The tip of the day, picked once when the module loads. The previous
 * useMemo(…, []) was just as fixed for the life of the app, but reached for
 * the clock during render to say so.
 */
const DAILY_TIP = (() => {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return TIPS[dayOfYear % TIPS.length];
})();

export function useIDEHandlers(state: ReturnType<typeof useIDEState>) {
  const [clipboard, setClipboard] = useState<{ path: string; isDirectory: boolean } | null>(null);
  // Deliberately not window.confirm: in the Tauri webview it shows its dialog
  // without pausing the script, so a delete gated on it ran unasked. The page
  // renders `confirmDialog` for these questions to appear at all.
  const { confirm, confirmDialog } = useConfirm();

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
          const existing = existingByPath.get(e.path);
          return {
            name: e.name,
            path: e.path,
            isDirectory: e.isDirectory,
            expanded: existing?.expanded ?? false,
            children: existing?.children ?? (e.isDirectory ? [] : undefined),
            gitStatus: resolveGitStatus(relativeToRoot(e.path, path), statuses),
          };
        });
        state.setFileTree(tree);
        return entries;
      } else {
        const entries = await readDirectory(path);
        // Lazy-loaded children need the same git-status treatment as the root
        // tree gets, or a freshly expanded folder shows every file as
        // untouched — including ones `.gitignore` already dims at the root.
        const rootPath = state.rootPath;
        const statuses = useStore.getState().fileStatuses;
        const children: FileNode[] = entries.map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.isDirectory,
          expanded: false,
          children: e.isDirectory ? [] : undefined,
          gitStatus: rootPath
            ? resolveGitStatus(relativeToRoot(e.path, rootPath), statuses)
            : undefined,
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
    state.setSelectedPaths([]);
    state.setSelectionAnchor(null);
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
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
      // Activating the tab is all it takes — the activeTabId effect loads the
      // content (and skips redundant reloads when the tab is already active).
      state.openTab({ id: path, path, name: path.split('/').pop() ?? path });
    },
    [state]
  );

  /** Opens a Find-in-Files result: switch to the tab, then jump to its line. */
  const handleFindInFilesNavigate = useCallback(
    async (path: string, line: number) => {
      if (useStore.getState().activeTabId !== path) {
        await handleFileSelect(path);
        await loadTabContent(path);
      }
      state.setScrollToLine(line);
    },
    [state, handleFileSelect, loadTabContent]
  );

  /** Pure selection — no tab open. What arrow-key navigation should do. */
  const handleFocusNode = useCallback(
    (path: string) => {
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
    },
    [state]
  );

  const handleToggleSelect = useCallback(
    (path: string) => {
      const current =
        state.selectedPaths.length > 0
          ? state.selectedPaths
          : state.selectedPath
            ? [state.selectedPath]
            : [];
      const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      state.setSelectedPaths(next);
      state.selectFile(path);
      state.setSelectionAnchor(path);
    },
    [state]
  );

  const handleRangeSelect = useCallback(
    (paths: string[], newPrimary: string) => {
      state.setSelectedPaths(paths);
      state.selectFile(newPrimary);
      // Anchor stays put — repeated shift-clicks keep measuring from the
      // same pivot, matching Finder/VS Code.
    },
    [state]
  );

  const handleClearSelection = useCallback(() => {
    state.setSelectedPaths(state.selectedPath ? [state.selectedPath] : []);
  }, [state]);

  const handleToggleDir = useCallback(
    async (path: string) => {
      // Selecting the folder (not just expanding it) is what makes it the
      // target for "New File"/"New Folder" from the toolbar. A plain click
      // always replaces whatever multi-selection came before it.
      state.selectFile(path);
      state.setSelectedPaths([path]);
      state.setSelectionAnchor(path);
      state.toggleExpand(path);
      const entries = await readDirectory(path);
      // Lazy-loaded children need the same git-status treatment as the root
      // tree gets, or a freshly expanded folder shows every file as
      // untouched — including ones `.gitignore` already dims at the root.
      const rootPath = state.rootPath;
      const statuses = useStore.getState().fileStatuses;
      const children: FileNode[] = entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.isDirectory,
        expanded: false,
        children: e.isDirectory ? [] : undefined,
        gitStatus: rootPath
          ? resolveGitStatus(relativeToRoot(e.path, rootPath), statuses)
          : undefined,
      }));
      state.setDirectoryChildren(path, children);
    },
    [state]
  );

  /**
   * Ask for the file name up front rather than creating an `untitled-*` file
   * the user then has to rename — one dialog instead of two round trips. The
   * file lands next to whatever is selected, falling back to the project root.
   */
  const handleNewFile = useCallback(async () => {
    if (!state.rootPath) return;
    const parentDir = newItemParentDir(
      state.rootPath,
      state.selectedPath,
      useStore.getState().fileTree ?? []
    );
    state.setNewItemModal({ type: 'file', parentDir });
  }, [state]);

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

  // Editing autosaves, but a write per keystroke races itself: two writes of
  // the same file can land out of order and undo what was just typed. The
  // queue debounces the burst and keeps writes serialized per file.
  const [autosave] = useState<ReturnType<typeof createAutosave>>(() =>
    createAutosave({
      write: writeFile,
      onSaved: (path, content) => {
        const store = useStore.getState();
        store.markDirty(path, false);
        store.updateFileInIndex(path, content);
      },
      onError: (path, error) => {
        const name = path.split('/').pop() ?? path;
        useStore
          .getState()
          .showToast(
            `Could not save ${name}: ${error instanceof Error ? error.message : String(error)}`,
            'error'
          );
      },
    })
  );

  // A window closing mid-debounce would drop the last few hundred milliseconds
  // of typing.
  useEffect(() => {
    const flushPending = () => void autosave.flush();
    window.addEventListener('beforeunload', flushPending);
    return () => window.removeEventListener('beforeunload', flushPending);
  }, [autosave]);

  const handleSave = useCallback(async () => {
    if (!state.activeTabId) return;
    autosave.schedule(state.activeTabId, state.editorContent);
    await autosave.flush();
  }, [state, autosave]);

  const handleEditorChange = useCallback(
    (newContent: string) => {
      state.setEditorContent(newContent);
      if (!state.activeTabId) return;
      state.markDirty(state.activeTabId, true);
      autosave.schedule(state.activeTabId, newContent);
    },
    [state, autosave]
  );

  // Scratch files are global (app-data dir) and deliberately independent of
  // any open project — none of these handlers guards on rootPath. Every
  // mutation refreshes the list because no file watcher covers the scratch dir.
  const handleNewScratch = useCallback(async () => {
    let dir = useStore.getState().scratchDir;
    if (!dir) {
      await useStore.getState().initScratches();
      dir = useStore.getState().scratchDir;
    }
    if (!dir) {
      useStore.getState().showToast('Could not resolve the scratch directory', 'error');
      return;
    }
    const name = nextScratchName(useStore.getState().scratches.map((s) => s.name));
    const path = `${dir}/${name}`;
    await writeFile(path, '');
    await useStore.getState().refreshScratches();
    handleFileSelect(path);
  }, [handleFileSelect]);

  const handleDeleteScratch = useCallback(
    async (path: string) => {
      // Flush first — a debounced autosave landing after the delete would
      // recreate the file.
      await autosave.flush();
      state.closeTab(path);
      await deleteFile(path);
      await useStore.getState().refreshScratches();
      useStore.getState().showToast('Scratch deleted', 'success');
    },
    [state, autosave]
  );

  const handleCleanAllScratches = useCallback(async () => {
    const scratches = useStore.getState().scratches;
    if (scratches.length === 0) return;
    await autosave.flush();
    for (const s of scratches) state.closeTab(s.path);
    for (const s of scratches) await deleteFile(s.path);
    await useStore.getState().refreshScratches();
    useStore
      .getState()
      .showToast(
        `Deleted ${scratches.length} scratch file${scratches.length === 1 ? '' : 's'}`,
        'success'
      );
  }, [state, autosave]);

  const handleRenameScratch = useCallback(
    async (oldPath: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed.includes('/')) return;
      const finalName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
      const dir = oldPath.slice(0, oldPath.lastIndexOf('/'));
      const newPath = `${dir}/${finalName}`;
      if (newPath === oldPath) return;
      if (useStore.getState().scratches.some((s) => s.path === newPath)) {
        useStore.getState().showToast(`"${finalName}" already exists`, 'error');
        return;
      }
      await autosave.flush();
      try {
        await movePath(oldPath, newPath);
      } catch (err) {
        useStore
          .getState()
          .showToast(typeof err === 'string' ? err : `Could not rename "${finalName}"`, 'error');
        return;
      }
      state.renamePath(oldPath, newPath);
      await useStore.getState().refreshScratches();
    },
    [state, autosave]
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
        await persistQuietly(useStore.getState().saveGoals(state.rootPath));
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

  const handleResumeInterrupted = useCallback(
    async (id: string) => {
      try {
        const agent = await state.resumeInterruptedAgent(id);
        state.setFullscreenAgent(agent);
      } catch (err) {
        console.error('Failed to resume interrupted agent', err);
      }
    },
    [state]
  );

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

      if (store.rootPath) persistInBackground(store.savePmData(store.rootPath));
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

  const handlePush = useCallback(async () => {
    if (!state.rootPath) return;
    const { showToast } = useStore.getState();
    try {
      await state.pushBranch(state.rootPath);
      showToast('Pushed to origin', 'success');
    } catch (e) {
      // The error names the fix (no remote, no credentials) — surface it
      // instead of leaving a button that silently did nothing.
      showToast(String(e), 'error');
    }
  }, [state]);

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

  /** Right-click on the empty area below the tree — targets the project root. */
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

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  const handleCopyPaths = useCallback((paths: string[]) => {
    navigator.clipboard.writeText(paths.join('\n'));
  }, []);

  const handleRenameRequest = useCallback(
    (node: FileTreeNode) => {
      state.setRenameDialog({ path: node.path, oldName: node.name, isDirectory: node.isDirectory });
    },
    [state]
  );

  const handleRevealInFileManager = useCallback((path: string) => {
    revealInFileManager(path);
  }, []);

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      const dialog = state.renameDialog;
      if (!dialog) return;
      const parentDir = dialog.path.split('/').slice(0, -1).join('/');
      const destination = `${parentDir}/${newName}`;
      if (destination === dialog.path) {
        state.setRenameDialog(null);
        return;
      }
      try {
        await movePath(dialog.path, destination);
      } catch (err) {
        const message = typeof err === 'string' ? err : `Could not rename "${dialog.oldName}"`;
        state.showToast(message, 'error');
        return;
      }

      // Keep [[wiki-links]] pointing at the file we just moved. Directories
      // don't map to a single wiki-link target, so only files get this.
      if (
        !dialog.isDirectory &&
        (dialog.oldName.endsWith('.md') || dialog.oldName.endsWith('.markdown'))
      ) {
        const store = useStore.getState();
        const referencingPaths = store
          .getBacklinksFor(dialog.oldName)
          .filter((p) => p !== dialog.path);
        if (referencingPaths.length > 0) {
          try {
            const referencingFiles = new Map<string, string>();
            for (const p of referencingPaths) {
              try {
                referencingFiles.set(p, await readFile(p));
              } catch {
                // Unreadable — leave its links stale rather than fail the rename.
              }
            }
            const changes = computeFileRenameChanges(dialog.oldName, newName, referencingFiles);
            const byFile = new Map<string, typeof changes>();
            for (const change of changes) {
              const list = byFile.get(change.filePath) ?? [];
              list.push(change);
              byFile.set(change.filePath, list);
            }
            for (const [fp, fileChanges] of byFile) {
              const original = referencingFiles.get(fp) ?? '';
              const updated = applyChangesToContent(original, fileChanges);
              await writeFile(fp, updated);
              store.updateFileInIndex(fp, updated);
              if (state.activeTabId === fp) state.setEditorContent(updated);
            }
          } catch {
            // Best-effort: the move already succeeded; don't fail the rename
            // over a link-rewrite problem.
          }
        }
      }

      state.renamePath(dialog.path, destination);
      if (state.selectedPath === dialog.path || state.selectedPath?.startsWith(dialog.path + '/')) {
        state.selectFile(state.selectedPath.replace(dialog.path, destination));
      }
      state.setRenameDialog(null);
      await handleRefresh(parentDir);
    },
    [state, handleRefresh]
  );

  /**
   * Append the node to the project root's `.gitignore`, creating the file when
   * the project doesn't have one yet.
   */
  const handleAddToGitignore = useCallback(
    async (node: FileTreeNode) => {
      const entry = toGitignoreEntry(state.rootPath, node.path, node.isDirectory);
      if (!entry || !state.rootPath) return;
      const root = state.rootPath.endsWith('/') ? state.rootPath.slice(0, -1) : state.rootPath;
      const gitignorePath = `${root}/.gitignore`;
      try {
        const current = (await exists(gitignorePath)) ? await readFile(gitignorePath) : '';
        const next = appendGitignoreEntry(current, entry);
        if (next === null) {
          state.showToast(`"${entry}" is already in .gitignore`, 'info');
          return;
        }
        await writeFile(gitignorePath, next);
      } catch (err) {
        const message = typeof err === 'string' ? err : 'Could not update .gitignore';
        state.showToast(message, 'error');
        return;
      }
      state.showToast(`Added "${entry}" to .gitignore`, 'success');
      // Re-read git status so the newly ignored item greys out immediately.
      await handleRefresh();
    },
    [state, handleRefresh]
  );

  /** Handles both a single delete and a bulk multi-select delete — one confirm either way. */
  const handleDeleteSelection = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const label =
        paths.length === 1 ? (paths[0].split('/').pop() ?? paths[0]) : `${paths.length} items`;
      const backlinkWarning = computeBacklinkWarning(paths, useStore.getState().getBacklinksFor);
      const message = backlinkWarning
        ? `This removes ${label} permanently. ${backlinkWarning}`
        : `This removes ${label} permanently.`;
      const go = await confirm({
        title: paths.length === 1 ? 'Delete this file?' : 'Delete these items?',
        message,
        confirmLabel: 'Delete',
      });
      if (!go) return;
      const { deleteFile } = await import('@/lib/tauri/fs');
      await Promise.all(paths.map((p) => deleteFile(p)));
      state.setSelectedPaths([]);
      await handleRefresh();
    },
    [state, handleRefresh, confirm]
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
      const isFolder = state.newItemModal.type === 'folder';
      if (isFolder) {
        const { createDirectory } = await import('@/lib/tauri/fs');
        await createDirectory(fullPath);
      } else {
        // .excalidraw files must be born as a parseable empty scene — a
        // zero-byte file only ever renders the "not a valid scene" panel.
        const seed = name.endsWith('.excalidraw') ? emptyExcalidrawSceneJson() : '';
        await writeFile(fullPath, seed);
      }
      await handleRefresh(state.newItemModal.parentDir);
      state.setNewItemModal(null);
      // Drop the user straight into the new file; folders just appear in the tree.
      if (!isFolder) handleFileSelect(fullPath);
    },
    [state, handleRefresh, handleFileSelect]
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
      if (id === 'goal-lines') {
        // Data loads happen on the modal's own mount effect.
        useStore.getState().setGoalLinesOpen(true);
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
    // Synthetic node from handleRootContextMenu — the empty-area right-click
    // below the tree. It's a real folder (the project root) but has no
    // parent, so rename/delete/gitignore don't make sense for it.
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

    // A multi-selection gets a narrow menu of the ops that make sense across
    // a set, same as Finder collapsing to "N items" — everything else below
    // (Rename, gitignore, Reveal…) is only meaningful for one target.
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
      // Only offer it for objects inside the project — and never for the
      // .gitignore itself, which would ignore the rules file.
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
  ]);

  // Command palette
  const commandActions = useMemo<Record<string, () => void>>(
    () => ({
      'file.new': handleNewFile,
      'file.open-folder': handleOpenFolder,
      'file.search': () => state.setFileSearchOpen(true),
      'file.advanced-selection': () => state.setFileSelectorOpen(true),
      'file.find-in-files': () => {
        if (state.rootPath) state.setFindInFilesOpen(true);
      },
      'file.save': handleSave,
      'file.new-scratch': () => void handleNewScratch(),
      'file.import-spec': () => state.setImportSpecDialogOpen(true),
      'file.import-video': () => state.setVideoImportDialogOpen(true),
      'git.commit': handleCommit,
      'git.stage-all': () => {
        const store = useStore.getState();
        if (!store.rootPath) return;
        void store.stageAll(store.rootPath);
      },
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
      'view.goal-lines': () => useStore.getState().setGoalLinesOpen(true),
      'view.notifications': () => state.setActiveActivity('notifications'),
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
    [
      state,
      handleNewFile,
      handleNewDiagram,
      handleOpenFolder,
      handleSave,
      handleCommit,
      handleNewScratch,
    ]
  );

  const commands = useMemo(
    () =>
      defaultCommands.map((cmd) => ({
        ...cmd,
        action: commandActions[cmd.id] ?? contextBoundAction(cmd.id),
      })),
    [commandActions]
  );

  /**
   * The commands the palette can perform right here. Everything else is
   * context-bound and only explains itself. The native menu reads this to
   * decide what to grey out, so a caller can see *why* it cannot act.
   */
  const performableCommandIds = useMemo(() => Object.keys(commandActions), [commandActions]);

  const handleCommandExecute = useCallback(
    (commandId: string) => {
      commands.find((c) => c.id === commandId)?.action();
      useStore.getState().recordCommandUse(commandId);
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
        // Unread across every project, never narrowed by the panel's filters —
        // and deliberately not summed with the agents panel's attention count,
        // which answers a different question.
        if (item.id === 'notifications')
          return {
            ...item,
            badge: state.notificationsUnreadCount > 0 ? state.notificationsUnreadCount : undefined,
          };
        return item;
      }),
    [scBadge, openTicketsCount, state.notificationsUnreadCount]
  );

  const dailyTip = DAILY_TIP;

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
    handleFindInFilesNavigate,
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
    handleNewScratch,
    handleDeleteScratch,
    handleCleanAllScratches,
    handleRenameScratch,
    handleSelectionSpawn,
    handleSpawnNewAgent,
    handleKillAgent,
    handleSelectAgent,
    handleResumeInterrupted,
    handleImageDrop,
    handleOpenTerminalHere,
    handleCloseTerminal,
    handleCanvasNodesChange,
    handleMindmapNodesChange,
    handleMindmapNodeEdit,
    handleCommit,
    handlePush,
    handleDiscardFile,
    handleDiffFileClick,
    handleContextMenu,
    handleRootContextMenu,
    handleCopyPath,
    handleRenameConfirm,
    handleAddToGitignore,
    handleDeleteSelection,
    handleRenameRequest,
    handleFocusNode,
    handleToggleSelect,
    handleRangeSelect,
    handleClearSelection,
    handlePaste,
    handleCreateNewItem,
    handleActivitySelect,
    handleWikiLinkNavigate,
    handleProblemsClick,
    contextMenuOptions,
    commands,
    performableCommandIds,
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
    /** Render this once in the page — the handlers above ask their questions here. */
    confirmDialog,
  };
}
