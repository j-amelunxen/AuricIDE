'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { brokenLinksSetFacet } from '@/lib/editor/wikiLinkBrokenExtension';
import { fileListFacet, headingProviderFacet } from '@/lib/editor/wikiLinkCompletionExtension';
import { useStore } from '@/lib/store';
import {
  slashCommandsFacet,
  mergeSlashCommands,
  slashCommands as defaultSlashCommands,
} from '@/lib/editor/slashCommandSource';
import { filePathsFacet } from '@/lib/editor/markdownCompletionSource';
import {
  wikiLinkHoverExtension,
  previewFetcherFacet,
  navigateCallbackFacet,
  type PreviewFetcher,
  type NavigateCallback,
} from '@/lib/editor/wikiLinkHoverExtension';
import {
  renameHeadingExtension,
  renameHeadingCallbackFacet,
} from '@/lib/editor/renameHeadingExtension';
import { computeHeadingRenameChanges } from '@/lib/refactoring/renameHeading';
import { applyChangesToContent } from '@/lib/refactoring/applyRenameChanges';
import { computeSectionExtraction } from '@/lib/refactoring/extractSection';
import { applyExtractSection } from '@/lib/refactoring/applyExtractSection';
import { showReferencesFacet } from '@/lib/editor/findReferencesExtension';
import {
  lintConfigFacet,
  fileListForLintFacet,
  headingIndexForLintFacet,
  currentFilePathFacet,
} from '@/lib/editor/markdownLintExtension';
import { findAllReferences } from '@/lib/refactoring/findReferences';
import { RenameHeadingDialog } from '@/app/components/refactoring/RenameHeadingDialog';
import { ExtractSectionDialog } from '@/app/components/refactoring/ExtractSectionDialog';
import { MarkdownPreview } from './MarkdownPreview';
import { detectAsciiArt } from '@/lib/ascii-art/detector';
import { repairAsciiArt } from '@/lib/ascii-art/repair';
import { SelectionMenu } from './SelectionMenu';
import {
  createEditorState,
  getLanguageExtension,
  buildHeadingTitleIndex,
} from '@/lib/editor/setup';

interface UniversalEditorProps {
  content: string;
  filePath?: string;
  projectFiles?: string[];
  scrollToLine?: number;
  onChange?: (content: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onSelectionSpawn?: (selection: string) => void;
  onWikiLinkNavigate?: (targetPath: string) => void;
  onExtractSectionReady?: (handler: (title: string, line: number) => void) => void;
}

export function MarkdownEditor({
  content,
  filePath,
  projectFiles = [],
  scrollToLine,
  onChange,
  onCursorChange,
  onSelectionSpawn,
  onWikiLinkNavigate,
  onExtractSectionReady,
}: UniversalEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState('');
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [isAsciiArt, setIsAsciiArt] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{
    title: string;
    line: number;
    refCount: number;
  } | null>(null);
  const [extractDialog, setExtractDialog] = useState<{
    title: string;
    suggestedFileName: string;
    contentPreview: string;
    line: number;
  } | null>(null);

  // Refs keep callbacks stable across renders so the CodeMirror onUpdate
  // closure (captured once at mount) always calls the latest handler.
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

  const compartments = useRef<Record<string, Compartment>>({
    language: new Compartment(),
    nlp: new Compartment(),
    deepNlp: new Compartment(),
    mermaid: new Compartment(),
    wikiLink: new Compartment(),
    brokenLinks: new Compartment(),
    fold: new Compartment(),
    autocomplete: new Compartment(),
    filePaths: new Compartment(),
    wikiLinkCompletion: new Compartment(),
    hover: new Compartment(),
    headingProvider: new Compartment(),
    renameHeading: new Compartment(),
    findReferences: new Compartment(),
    lint: new Compartment(),
    slashCmds: new Compartment(),
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const state = createEditorState({
      content,
      filePath,
      projectFiles,
      compartments: compartments.current,
      onUpdate: (update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet) {
          const main = update.state.selection.main;
          if (onCursorChangeRef.current) {
            const line = update.state.doc.lineAt(main.head);
            onCursorChangeRef.current(line.number, main.head - line.from + 1);
          }
          if (!main.empty) {
            const selectedText = update.state.doc.sliceString(main.from, main.to);
            setSelection(selectedText);
            setSelectionRange({ from: main.from, to: main.to });
            setIsAsciiArt(detectAsciiArt(selectedText));
            const coords = viewRef.current?.coordsAtPos(main.to);
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (coords && rect) {
              setMenuPos({ x: coords.left - rect.left, y: coords.top - rect.top - 30 });
            }
          } else {
            setMenuPos(null);
            setSelection('');
            setSelectionRange(null);
            setIsAsciiArt(false);
          }
        }
      },
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const isMarkdown = !filePath || filePath.endsWith('.md') || filePath.endsWith('.markdown');

    view.dispatch({
      effects: [
        compartments.current.language.reconfigure(getLanguageExtension(filePath)),
        compartments.current.filePaths.reconfigure(filePathsFacet.of(projectFiles)),
        compartments.current.wikiLinkCompletion.reconfigure(
          isMarkdown ? fileListFacet.of(projectFiles) : []
        ),
        compartments.current.headingProvider.reconfigure(
          isMarkdown
            ? headingProviderFacet.of((p) => useStore.getState().headingIndex.get(p) || [])
            : []
        ),
        compartments.current.brokenLinks.reconfigure(
          isMarkdown
            ? brokenLinksSetFacet.of(
                new Set(useStore.getState().brokenLinks?.get(filePath ?? '') || [])
              )
            : []
        ),
        compartments.current.lint.reconfigure(
          isMarkdown
            ? [
                lintConfigFacet.of(useStore.getState().lintConfig),
                fileListForLintFacet.of(useStore.getState().allFilePaths),
                headingIndexForLintFacet.of(buildHeadingTitleIndex()),
                currentFilePathFacet.of(filePath ?? ''),
              ]
            : []
        ),
        compartments.current.slashCmds.reconfigure(
          isMarkdown
            ? slashCommandsFacet.of(
                mergeSlashCommands(defaultSlashCommands, useStore.getState().customSlashCommands)
              )
            : []
        ),
        compartments.current.renameHeading.reconfigure(
          isMarkdown
            ? [
                renameHeadingExtension,
                renameHeadingCallbackFacet.of((title, line) => {
                  const state = useStore.getState();
                  const currentFile = filePath ?? '';
                  const currentFileName = currentFile.split('/').pop() ?? '';
                  const results = findAllReferences(title, 'heading', {
                    headingTarget: currentFileName,
                    entityIndex: state.entityIndex,
                    linkIndex: state.linkIndex,
                  });
                  setRenameDialog({ title, line, refCount: results.length });
                }),
              ]
            : []
        ),
        compartments.current.findReferences.reconfigure(
          isMarkdown
            ? showReferencesFacet.of((query, queryType) => {
                const state = useStore.getState();
                const currentFile = filePath ?? '';
                const currentFileName = currentFile.split('/').pop() ?? '';
                const results = findAllReferences(query, queryType, {
                  headingTarget: currentFileName,
                  entityIndex: state.entityIndex,
                  linkIndex: state.linkIndex,
                });
                state.setReferencesPanel(true, query, results);
              })
            : []
        ),
      ],
    });
  }, [filePath, projectFiles]);

  useEffect(() => {
    if (viewRef.current && content !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: content },
      });
    }
  }, [content]);

  useEffect(() => {
    if (viewRef.current && scrollToLine) {
      const line = viewRef.current.state.doc.line(
        Math.min(scrollToLine, viewRef.current.state.doc.lines)
      );
      viewRef.current.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    }
  }, [scrollToLine]);

  const handleExtractSection = useCallback(
    (title: string, line: number) => {
      const extraction = computeSectionExtraction(content, line);
      if (!extraction) return;
      setExtractDialog({
        title: extraction.headingTitle,
        suggestedFileName: extraction.suggestedFileName,
        contentPreview: extraction.sectionContent.slice(0, 300),
        line,
      });
    },
    [content]
  );

  useEffect(() => {
    if (onExtractSectionReady) onExtractSectionReady(handleExtractSection);
  }, [onExtractSectionReady, handleExtractSection]);

  const handleFixAsciiArt = useCallback(() => {
    if (!viewRef.current || !selectionRange) return;
    const fixed = repairAsciiArt(selection);
    viewRef.current.dispatch({
      changes: { from: selectionRange.from, to: selectionRange.to, insert: fixed },
    });
    setMenuPos(null);
    setIsAsciiArt(false);
    setSelectionRange(null);
  }, [selection, selectionRange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previewCache = new Map<string, string>();
    const fetcher: PreviewFetcher = (target) => {
      const state = useStore.getState();
      const exists = !state.isBrokenLink(target);
      const cached = previewCache.get(target);
      if (exists && !cached) {
        const fullPath = state.allFilePaths.find(
          (p) =>
            p.toLowerCase().endsWith('/' + target.toLowerCase()) ||
            p.toLowerCase().endsWith('\\' + target.toLowerCase())
        );
        if (fullPath) {
          import('@/lib/tauri/fs').then((m) =>
            m.readFile(fullPath).then((c) => previewCache.set(target, c.slice(0, 200)))
          );
        }
      }
      return { exists, preview: cached ?? '' };
    };
    const navigate: NavigateCallback = (target) => onWikiLinkNavigate?.(target);
    view.dispatch({
      effects: compartments.current.hover.reconfigure([
        ...wikiLinkHoverExtension,
        previewFetcherFacet.of(fetcher),
        navigateCallbackFacet.of(navigate),
      ]),
    });
  }, [onWikiLinkNavigate]);

  const isMarkdown = !filePath || filePath.endsWith('.md') || filePath.endsWith('.markdown');

  return (
    <div ref={wrapperRef} className="relative h-full w-full overflow-hidden bg-editor-bg">
      {isMarkdown && (
        <div className="absolute top-2 right-2 z-40">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-panel-bg border border-white/10 text-foreground-muted hover:text-primary hover:border-primary/30 transition-all shadow-lg"
            title={showPreview ? 'Hide preview' : 'Show preview'}
            data-testid="preview-toggle"
          >
            <span className="material-symbols-outlined text-sm">
              {showPreview ? 'visibility_off' : 'visibility'}
            </span>
            {showPreview ? 'Hide Preview' : 'Show Preview'}
          </button>
        </div>
      )}

      <div className="flex h-full w-full">
        <div
          className={showPreview ? 'w-1/2 border-r border-white/10' : 'w-full'}
          style={{ transition: 'width 0.2s ease-in-out' }}
        >
          <div
            ref={containerRef}
            data-testid="markdown-editor"
            className="h-full w-full overflow-auto"
          />
        </div>
        {showPreview && (
          <div className="w-1/2 h-full overflow-hidden">
            <MarkdownPreview content={content} onContentChange={onChange} />
          </div>
        )}
      </div>

      {renameDialog && (
        <RenameHeadingDialog
          oldTitle={renameDialog.title}
          referenceCount={renameDialog.refCount}
          onCancel={() => setRenameDialog(null)}
          onConfirm={async (newTitle) => {
            const currentFile = filePath ?? '';
            const currentFileName = currentFile.split('/').pop() ?? '';
            try {
              const { readFile, writeFile } = await import('@/lib/tauri/fs');
              const allPaths = useStore.getState().allFilePaths;
              const workspace = new Map<string, string>();
              for (const p of allPaths) {
                if (p.endsWith('.md')) {
                  try {
                    const c = await readFile(p);
                    workspace.set(p, c);
                  } catch {}
                }
              }
              const changes = computeHeadingRenameChanges(
                currentFile,
                currentFileName,
                renameDialog.title,
                newTitle,
                workspace
              );
              const byFile = new Map<string, typeof changes>();
              for (const change of changes) {
                const list = byFile.get(change.filePath) ?? [];
                list.push(change);
                byFile.set(change.filePath, list);
              }
              for (const [fp, fileChanges] of byFile) {
                const original = workspace.get(fp) ?? '';
                const updated = applyChangesToContent(original, fileChanges);
                await writeFile(fp, updated);
                if (fp === currentFile && onChange) onChange(updated);
              }
            } catch {
              if (viewRef.current) {
                const doc = viewRef.current.state.doc.toString();
                const changes = computeHeadingRenameChanges(
                  currentFile,
                  currentFileName,
                  renameDialog.title,
                  newTitle,
                  new Map([[currentFile, doc]])
                );
                const updated = applyChangesToContent(doc, changes);
                if (onChange) onChange(updated);
              }
            }
            setRenameDialog(null);
          }}
        />
      )}

      {extractDialog && (
        <ExtractSectionDialog
          headingTitle={extractDialog.title}
          suggestedFileName={extractDialog.suggestedFileName}
          contentPreview={extractDialog.contentPreview}
          onCancel={() => setExtractDialog(null)}
          onConfirm={async (fileName) => {
            const currentFile = filePath ?? '';
            const extraction = computeSectionExtraction(content, extractDialog.line);
            if (!extraction) {
              setExtractDialog(null);
              return;
            }
            try {
              const { readFile, writeFile } = await import('@/lib/tauri/fs');
              await applyExtractSection(currentFile, extraction, fileName, readFile, writeFile);
              const updatedSource =
                content.slice(0, extraction.sectionFrom) +
                extraction.replacementText +
                content.slice(extraction.sectionTo);
              if (onChange) onChange(updatedSource);
            } catch {
              const updatedSource =
                content.slice(0, extraction.sectionFrom) +
                extraction.replacementText +
                content.slice(extraction.sectionTo);
              if (onChange) onChange(updatedSource);
            }
            setExtractDialog(null);
          }}
        />
      )}

      {menuPos && (
        <SelectionMenu
          x={menuPos.x}
          y={menuPos.y}
          selection={selection}
          isAsciiArt={isAsciiArt}
          onSpawnAgent={(sel) => {
            onSelectionSpawn?.(sel);
            setMenuPos(null);
          }}
          onFixAsciiArt={handleFixAsciiArt}
        />
      )}
    </div>
  );
}
