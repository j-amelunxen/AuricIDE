'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { createAutosave } from '@/lib/editor/autosave';
import { readFile, readFileBase64, writeFile, deleteFile, movePath } from '@/lib/tauri/fs';
import { nextScratchName } from '@/lib/scratch/naming';
import { imageDataUri, localFileSrc, previewKind } from '@/lib/media/preview';
import { isDiffTabId } from '@/lib/git/diffTabId';
import { extractHeadings, getHeadingBreadcrumbs } from '@/lib/editor/markdownHeadingParser';
import type { useIDEState } from '../useIDEState';

export function useEditorAndScratchHandlers(
  state: ReturnType<typeof useIDEState>,
  handleFileSelect: (path: string) => Promise<void>
) {
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

  useEffect(() => {
    const flushPending = () => void autosave.flush();
    window.addEventListener('beforeunload', flushPending);
    return () => window.removeEventListener('beforeunload', flushPending);
  }, [autosave]);

  const loadTabContent = useCallback(
    async (path: string) => {
      const kind = previewKind(path);
      if (kind === 'image') {
        const data = await readFileBase64(path);
        if (useStore.getState().activeTabId !== path) return;
        state.setImageData(imageDataUri(data, path));
        state.setVideoSrc(null);
        state.setPdfData(null);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else if (kind === 'video') {
        const src = await localFileSrc(path);
        if (useStore.getState().activeTabId !== path) return;
        state.setVideoSrc(src);
        state.setImageData(null);
        state.setPdfData(null);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else if (kind === 'pdf') {
        const data = await readFileBase64(path);
        if (useStore.getState().activeTabId !== path) return;
        state.setPdfData(data);
        state.setImageData(null);
        state.setVideoSrc(null);
        state.setEditorContent('');
        state.setMindmapData(null);
      } else {
        const content = await readFile(path);
        if (useStore.getState().activeTabId !== path) return;
        state.setEditorContent(content);
        state.setImageData(null);
        state.setVideoSrc(null);
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
    },
    [state]
  );

  const loadFileContent = useCallback(
    async (relativePath: string) => {
      if (!state.rootPath) throw new Error('No project root');
      return readFile(`${state.rootPath}/${relativePath}`);
    },
    [state.rootPath]
  );

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

  const handleImageDrop = useCallback((_agentId: string, _imageData: string) => {
    // Basic implementation placeholder
  }, []);

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

  const isDiffTab = !!state.activeTabId && isDiffTabId(state.activeTabId);
  const isWorkflowFile = !!state.activeTabId?.endsWith('.workflow.md');
  const isMindmapTab = !!state.activeTabId?.endsWith('.mindmap.md');
  const isObsidianCanvas = !!state.activeTabId?.endsWith('.canvas');
  const isExcalidrawTab = !!state.activeTabId?.endsWith('.excalidraw');
  const isHtmlTab = /\.html?$/i.test(state.activeTabId ?? '');

  return {
    autosave,
    loadTabContent,
    loadFileContent,
    handleSave,
    handleEditorChange,
    handleNewScratch,
    handleDeleteScratch,
    handleCleanAllScratches,
    handleRenameScratch,
    handleImageDrop,
    handleWikiLinkNavigate,
    breadcrumbs,
    headingBreadcrumbs,
    activeDiagCounts,
    activeDiagnostics,
    activeLanguage,
    isDiffTab,
    isWorkflowFile,
    isMindmapTab,
    isObsidianCanvas,
    isExcalidrawTab,
    isHtmlTab,
  };
}
