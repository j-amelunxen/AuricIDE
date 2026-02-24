'use client';

import { useCallback, useRef, useState } from 'react';
import { Command } from '@/lib/commands/registry';

export interface CommandPaletteProps {
  commands: Command[];
  isOpen: boolean;
  onClose: () => void;
  onExecute: (commandId: string) => void;
}

function filterCommands(commands: Command[], query: string): Command[] {
  if (query === '') return commands;

  const lowerQuery = query.toLowerCase();
  const prefixMatches: Command[] = [];
  const substringMatches: Command[] = [];

  for (const cmd of commands) {
    const lowerLabel = cmd.label.toLowerCase();
    const lowerCategory = cmd.category.toLowerCase();

    if (lowerLabel.startsWith(lowerQuery) || lowerCategory.startsWith(lowerQuery)) {
      prefixMatches.push(cmd);
    } else if (lowerLabel.includes(lowerQuery) || lowerCategory.includes(lowerQuery)) {
      substringMatches.push(cmd);
    }
  }

  return [...prefixMatches, ...substringMatches];
}

export function CommandPalette({ commands, isOpen, onClose, onExecute }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = filterCommands(commands, query);

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setSelectedIndex(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filtered.length);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (filtered.length > 0) {
            onExecute(filtered[selectedIndex].id);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          onClose();
          break;
        }
      }
    },
    [filtered, selectedIndex, onExecute, onClose]
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div
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
          className="w-full border-b border-border-dark bg-editor-bg px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none"
          autoFocus
        />

        <div className="max-h-[320px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div
              data-testid="command-palette-empty"
              className="px-4 py-8 text-center text-sm text-foreground-muted"
            >
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, index) => (
              <div
                key={cmd.id}
                data-testid="command-palette-item"
                data-selected={index === selectedIndex}
                className={`flex cursor-pointer items-center justify-between px-4 py-2 ${
                  index === selectedIndex
                    ? 'border-l-2 border-primary bg-primary/15'
                    : 'border-l-2 border-transparent hover:bg-primary/10'
                }`}
                onClick={() => onExecute(cmd.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    data-testid="command-category"
                    className="text-[10px] uppercase tracking-wider text-foreground-muted"
                  >
                    {cmd.category}
                  </span>
                  <span className="text-sm text-foreground">{cmd.label}</span>
                </div>

                {cmd.shortcut && (
                  <span
                    data-testid="command-shortcut"
                    className="rounded bg-background-dark px-1.5 py-0.5 text-xs text-foreground-muted"
                  >
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
