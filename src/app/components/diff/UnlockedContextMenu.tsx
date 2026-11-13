'use client';

import { useEffect, useRef, useState } from 'react';
import { countWordMatches, isIdentifier } from '@/lib/editor/textRename';

/**
 * Right-click menu of the unlocked diff editor: a text-level rename of the word
 * under the caret (whole identifiers, this file only) and find & replace.
 */
export function UnlockedContextMenu({
  x,
  y,
  word,
  content,
  onRename,
  onFind,
  onClose,
}: {
  x: number;
  y: number;
  word: string | null;
  content: () => string;
  onRename: (from: string, to: string) => void;
  onFind: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [target, setTarget] = useState(word ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const canRename = !!word && isIdentifier(word);
  const matches = canRename && word ? countWordMatches(content(), word) : 0;
  const valid = isIdentifier(target) && target !== word;

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [onClose]);

  const submit = () => {
    if (!word || !valid) return;
    onRename(word, target);
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Editor actions"
      data-testid="diff-unlocked-menu"
      style={{ position: 'fixed', left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="z-50 min-w-48 rounded-md border border-border-dark bg-panel-bg p-1 text-xs text-foreground shadow-lg"
    >
      {renaming && word ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-1 p-1"
        >
          <label className="text-foreground-muted" htmlFor="diff-rename-input">
            Rename {matches} {matches === 1 ? 'match' : 'matches'} of “{word}”
          </label>
          <input
            id="diff-rename-input"
            autoFocus
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="rounded bg-editor-bg px-2 py-1 outline-none ring-1 ring-primary/70"
          />
          <button
            type="submit"
            disabled={!valid}
            title={valid ? undefined : 'Enter a different valid identifier'}
            className="rounded px-2 py-1 text-left hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rename
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={!canRename}
            title={canRename ? undefined : 'Put the caret on a name first'}
            onClick={() => setRenaming(true)}
            className="block w-full rounded px-2 py-1 text-left hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rename{canRename ? ` “${word}”` : ''}… (this file)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onFind();
              onClose();
            }}
            className="block w-full rounded px-2 py-1 text-left hover:bg-hover-bg"
          >
            Find &amp; replace…
          </button>
        </>
      )}
    </div>
  );
}
