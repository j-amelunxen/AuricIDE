'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from '@/lib/commands/registry';
import { rankCommands } from '@/lib/commands/fuzzy';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';

export interface CommandPaletteProps {
  commands: Command[];
  isOpen: boolean;
  onClose: () => void;
  onExecute: (commandId: string) => void;
  /** Most-recently-used command ids, newest first. */
  recentIds?: readonly string[];
  /** When false, commands marked `requiresProject` are shown greyed and will not run. */
  hasProject?: boolean;
}

/** Splits a label into runs so matched characters can be emphasised in place. */
function splitOnMatches(label: string, indices: number[]): { text: string; match: boolean }[] {
  if (indices.length === 0) return [{ text: label, match: false }];

  const matched = new Set(indices);
  const parts: { text: string; match: boolean }[] = [];
  let current = '';
  let currentMatch = matched.has(0);

  for (let i = 0; i < label.length; i++) {
    const isMatch = matched.has(i);
    if (isMatch !== currentMatch) {
      if (current !== '') parts.push({ text: current, match: currentMatch });
      current = '';
      currentMatch = isMatch;
    }
    current += label[i];
  }
  if (current !== '') parts.push({ text: current, match: currentMatch });

  return parts;
}

export function CommandPalette({
  commands,
  isOpen,
  onClose,
  onExecute,
  recentIds = [],
  hasProject = true,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({
    id: 'command-palette',
    kind: 'tool',
    active: isOpen,
    onEscape: onClose,
  });

  const filtered = useMemo(
    () => rankCommands(commands, query, recentIds),
    [commands, query, recentIds]
  );

  // Without a query the list IS the recency list, so the badge would be noise
  // on every row; it only carries information while results are score-ordered.
  const showRecentBadges = query === '';
  const recentSet = useMemo(() => new Set(recentIds), [recentIds]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex, query]);

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  const isCommandUnavailable = useCallback(
    (cmd: Command) => Boolean(cmd.requiresProject && !hasProject),
    [hasProject]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (filtered.length === 0) return;
          setSelectedIndex((prev) => (prev + 1) % filtered.length);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (filtered.length === 0) return;
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (filtered.length === 0) return;
          const selected = filtered[selectedIndex].command;
          if (isCommandUnavailable(selected)) return;
          onExecute(selected.id);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          onClose();
          break;
        }
      }
    },
    [filtered, selectedIndex, onExecute, onClose, isCommandUnavailable]
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      data-testid="command-palette-overlay"
      className="fixed inset-0 z-[var(--z-tool-nested)] flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette-modal"
        className="w-[560px] max-h-[400px] rounded-lg border border-border-dark bg-panel-bg shadow-2xl"
      >
        <input
          ref={inputRef}
          data-testid="command-palette-input"
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Type a command..."
          className="w-full border-b border-border-dark bg-editor-bg px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted outline-none focus:ring-2 focus:ring-primary/50 focus:ring-inset"
          autoFocus
        />

        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div
              data-testid="command-palette-empty"
              className="px-4 py-8 text-center text-sm text-foreground-muted"
            >
              No matching commands
            </div>
          ) : (
            filtered.map(({ command: cmd, indices }, index) => {
              const unavailable = isCommandUnavailable(cmd);
              return (
                <div
                  key={cmd.id}
                  data-testid="command-palette-item"
                  data-selected={index === selectedIndex}
                  aria-disabled={unavailable || undefined}
                  className={`flex items-center justify-between px-4 py-2 ${
                    unavailable ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                  } ${
                    index === selectedIndex
                      ? 'border-l-2 border-primary bg-primary/15'
                      : unavailable
                        ? 'border-l-2 border-transparent'
                        : 'border-l-2 border-transparent hover:bg-primary/10'
                  }`}
                  onClick={() => {
                    if (unavailable) return;
                    onExecute(cmd.id);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      data-testid="command-category"
                      className="text-[10px] uppercase tracking-wider text-foreground-muted"
                    >
                      {cmd.category}
                    </span>
                    <span className="truncate text-sm text-foreground">
                      {splitOnMatches(cmd.label, indices).map((part, partIndex) =>
                        part.match ? (
                          <span
                            key={partIndex}
                            data-testid="command-label-match"
                            className="font-semibold text-primary"
                          >
                            {part.text}
                          </span>
                        ) : (
                          <span key={partIndex}>{part.text}</span>
                        )
                      )}
                    </span>
                    {showRecentBadges && recentSet.has(cmd.id) && (
                      <span
                        data-testid="command-recent"
                        title="Recently used"
                        aria-label="Recently used"
                        className="text-[10px] text-foreground-muted"
                      >
                        ↩
                      </span>
                    )}
                  </div>

                  {cmd.shortcut && (
                    <span
                      data-testid="command-shortcut"
                      className="ml-3 shrink-0 rounded bg-background-dark px-1.5 py-0.5 text-xs text-foreground-muted"
                    >
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-dark px-4 py-1.5 text-[11px] text-foreground-muted">
          <span data-testid="command-palette-count">
            {filtered.length} {filtered.length === 1 ? 'command' : 'commands'}
          </span>
          <span>↑↓ navigate · ↵ run · esc close</span>
        </div>
      </div>
    </div>
  );
}
