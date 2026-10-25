'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { createAutosave } from '@/lib/editor/autosave';
import {
  formatForSave,
  formatLanguageForTrigger,
  type FormatTrigger,
} from '@/lib/editor/format/formatOnSave';
import { applyFormattedText } from '@/lib/editor/format/activeEditor';
import { readFile, readFileBase64, writeFile, deleteFile, movePath } from '@/lib/tauri/fs';
import { nextScratchName } from '@/lib/scratch/naming';
import { imageDataUri, localFileSrc, previewKind } from '@/lib/media/preview';
import { isDiffTabId } from '@/lib/git/diffTabId';
import { isMergeTabId } from '@/lib/git/mergeTabId';
import { isReviewTabId } from '@/lib/git/review/reviewSession';
import { tabBreadcrumbs } from '@/lib/ide/tabBreadcrumbs';
import { isVirtualTabId } from '@/lib/git/virtualTabId';
import { extractHeadings, getHeadingBreadcrumbs } from '@/lib/editor/markdownHeadingParser';
import type { IDEState } from './liveIDEState';
import type { StoreDiagnostic } from '@/lib/store/diagnosticsSlice';

const NO_DIAGNOSTICS: StoreDiagnostic[] = [];

export function useEditorAndScratchHandlers(
  state: IDEState,
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

  // Files typed into since their last format. Leaving the editor formats only
  // these: a blur on an untouched buffer must not write it back, because the
  // editor does not reload on outside changes and its text may be stale — an
  // agent's edit would be overwritten by the old text.
  const [editedSinceFormat] = useState(() => new Set<string>());

  const handleSave = useCallback(
    async (trigger: FormatTrigger = 'save') => {
      // Diff, merge and review tabs are not files, and image, video and PDF
      // tabs hold no editor text: ⌘S there must not write `editorContent`.
      const path = state.activeTabId;
      if (!path || isVirtualTabId(path) || previewKind(path) !== 'text') return;
      if (trigger === 'blur') {
        if (!editedSinceFormat.has(path) || !formatLanguageForTrigger(path, 'blur')) return;
      }
      editedSinceFormat.delete(path);
      const content = state.editorContent;
      // The text as typed lands first, so formatting can only ever add to a
      // save that already happened — never delay or replace it.
      autosave.schedule(path, content);
      await autosave.flush();
      const formatted = await formatForSave(path, content, trigger);
      if (formatted === null) return;
      // Only through the editor, and only while it still shows this file with
      // this text: undo and the cursor survive, and a result that arrives
      // after the buffer moved on — or after the tab was left — is dropped
      // rather than written over newer text. The edit's onChange schedules
      // the write.
      if (useStore.getState().activeTabId !== path) return;
      if (!applyFormattedText(path, content, formatted)) return;
      editedSinceFormat.delete(path);
      await autosave.flush();
    },
    [state, autosave, editedSinceFormat]
  );

  const handleEditorBlur = useCallback(() => void handleSave('blur'), [handleSave]);

  const handleEditorChange = useCallback(
    (newContent: string) => {
      state.setEditorContent(newContent);
      // Same rule as handleSave: a diff, merge or review tab is not a file, so
      // it is never dirty and nothing is scheduled to a path named after its id.
      if (!state.activeTabId || isVirtualTabId(state.activeTabId)) return;
      state.markDirty(state.activeTabId, true);
      editedSinceFormat.add(state.activeTabId);
      autosave.schedule(state.activeTabId, newContent);
    },
    [state, autosave, editedSinceFormat]
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
    const tab = useStore.getState().openTabs.find((t) => t.id === state.activeTabId);
    return tabBreadcrumbs(state.activeTabId, tab);
  }, [state.activeTabId]);

  const isMarkdownFile = useMemo(
    () => !!state.activeTabId && /\.(md|markdown)$/i.test(state.activeTabId),
    [state.activeTabId]
  );
  // The cursor moves on every keystroke. Outside Markdown the breadcrumbs do
  // not use it, so the page does not subscribe to it there at all — and
  // inside Markdown only a change of line matters, not of column.
  const cursorLine = useStore((s) => (isMarkdownFile ? s.cursorPos.line : 0));
  const headingBreadcrumbs = useMemo(() => {
    if (!isMarkdownFile) return [];
    const headings = extractHeadings(state.editorContent);
    return getHeadingBreadcrumbs(headings, cursorLine);
  }, [isMarkdownFile, state.editorContent, cursorLine]);

  // Only the active file's diagnostics: linting another file must not
  // re-render the page.
  const activeTabId = state.activeTabId;
  const activeDiagnostics = useStore(
    (s) => (activeTabId ? s.diagnostics.get(activeTabId) : undefined) ?? NO_DIAGNOSTICS
  );
  const getDiagnosticCounts = state.getDiagnosticCounts;
  const activeDiagCounts = useMemo(
    () => (activeTabId ? getDiagnosticCounts(activeTabId) : { errors: 0, warnings: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the counts are computed from activeDiagnostics
    [activeTabId, activeDiagnostics, getDiagnosticCounts]
  );

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
  const isMergeTab = !!state.activeTabId && isMergeTabId(state.activeTabId);
  const isReviewTab = !!state.activeTabId && isReviewTabId(state.activeTabId);
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
    handleEditorBlur,
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
    isMergeTab,
    isReviewTab,
    isWorkflowFile,
    isMindmapTab,
    isObsidianCanvas,
    isExcalidrawTab,
    isHtmlTab,
  };
}
