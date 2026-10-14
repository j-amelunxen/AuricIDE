'use client';

import { useEffect, useRef, useState } from 'react';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Compartment, EditorState } from '@codemirror/state';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { auricHighlightStyle, auricTheme } from '@/lib/editor/auricTheme';
import { editorHistory } from '@/lib/editor/externalContentSync';
import { getLanguageExtension } from '@/lib/editor/setup';
import { isIdentifier, wordAt, wordMatchRanges } from '@/lib/editor/textRename';
import { applyFullFileEdit } from '@/lib/git/applyLineEdit';
import { readFile } from '@/lib/tauri/fs';
import { useStore } from '@/lib/store';
import { changedLinesExtension } from './changedLines';
import { UnlockedContextMenu } from './UnlockedContextMenu';

const SAVE_DELAY_MS = 700;

interface MenuState {
  x: number;
  y: number;
  word: string | null;
}

/**
 * The right-hand side of a diff with the lock open: the file on disk in a real
 * editor. Lines the patch added keep their background. Edits are written back
 * after a short pause, and only while the file on disk is still what this editor
 * last read or wrote.
 */
export function UnlockedEditor({
  repoPath,
  filePath,
  addedLineNumbers,
  restage,
  onClosed,
}: {
  repoPath: string;
  filePath: string;
  addedLineNumbers: readonly number[];
  restage: boolean;
  /** Runs after the final write when the editor goes away. */
  onClosed: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    let disposed = false;
    const languageSlot = new Compartment();

    const save = async () => {
      timer.current = null;
      const view = viewRef.current;
      if (!view) return;
      const next = view.state.doc.toString();
      if (next === savedRef.current) return;
      try {
        await applyFullFileEdit({
          repoPath,
          filePath,
          expectedOnDisk: savedRef.current,
          nextContent: next,
          restage,
        });
        savedRef.current = next;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useStore.getState().showToast(message, 'error');
      }
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    };

    void readFile(`${repoPath}/${filePath}`)
      .then((content) => {
        if (disposed || !host.current) return;
        savedRef.current = content;
        const view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: content,
            extensions: [
              auricTheme,
              auricHighlightStyle,
              lineNumbers(),
              editorHistory(),
              languageSlot.of(getLanguageExtension(filePath)),
              changedLinesExtension(addedLineNumbers),
              search({ top: true }),
              highlightSelectionMatches(),
              keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
              EditorView.lineWrapping,
              EditorView.updateListener.of((update) => {
                if (update.docChanged) schedule();
              }),
              EditorView.domEventHandlers({
                contextmenu: (event, v) => {
                  event.preventDefault();
                  const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
                  const selection = v.state.selection.main;
                  const word = selection.empty
                    ? pos === null
                      ? null
                      : wordAt(v.state.doc.toString(), pos)
                    : v.state.sliceDoc(selection.from, selection.to);
                  setMenu({ x: event.clientX, y: event.clientY, word });
                  return true;
                },
              }),
            ],
          }),
        });
        viewRef.current = view;
        // Languages outside the hand-picked set load from the shared catalogue.
        const matched = LanguageDescription.matchFilename(languages, filePath);
        if (matched && getLanguageExtension(filePath) instanceof Array) {
          void matched.load().then((support) => {
            if (!disposed) view.dispatch({ effects: languageSlot.reconfigure(support) });
          });
        }
      })
      .catch((error: unknown) => {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      // Leaving the unlocked view must not lose the last keystrokes.
      const finish = () => {
        viewRef.current?.destroy();
        onClosedRef.current();
      };
      if (timer.current) {
        clearTimeout(timer.current);
        void save().finally(finish);
      } else {
        finish();
      }
    };
    // The editor is created once per file; later patch changes must not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, filePath]);

  const rename = (from: string, to: string) => {
    const view = viewRef.current;
    if (!view || !isIdentifier(to)) return;
    // One small change per hit: the diff's line marks survive a rename.
    const changes = wordMatchRanges(view.state.doc.toString(), from).map((r) => ({
      ...r,
      insert: to,
    }));
    if (changes.length > 0) view.dispatch({ changes });
  };

  if (loadError) {
    return (
      <div role="alert" className="p-4 text-sm text-red-300">
        Could not open {filePath}: {loadError}
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-auto" data-testid="diff-unlocked-editor">
      <div ref={host} />
      {menu && (
        <UnlockedContextMenu
          x={menu.x}
          y={menu.y}
          word={menu.word}
          content={() => viewRef.current?.state.doc.toString() ?? ''}
          onRename={rename}
          onFind={() => viewRef.current && openSearchPanel(viewRef.current)}
          onClose={() => {
            setMenu(null);
            viewRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
