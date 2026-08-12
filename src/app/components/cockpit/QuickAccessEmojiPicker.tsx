'use client';

import { useEffect, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  emojiLabel,
  looksLikeEmoji,
  searchEmoji,
  type EmojiEntry,
} from '@/lib/quickAccess/emoji';
import { firstGrapheme } from '@/lib/quickAccess/icon';

const GRID_COLUMNS = 10;

interface QuickAccessEmojiPickerProps {
  /** The emoji currently on the tile, or '' when the tile shows something else. */
  value: string;
  onSelect: (emoji: string) => void;
  onClear: () => void;
}

/**
 * Picks an emoji for a project tile.
 *
 * Expands in place rather than floating: the dialog already scrolls, and an
 * inline panel needs no positioning maths, no outside-click handling and no
 * second focus trap on top of the one the dialog owns.
 *
 * The search box is also the paste field. Anything pictographic typed or
 * pasted into it is offered as a result even when the curated palette has
 * never heard of it, so the palette bounds browsing without bounding choice.
 */
export function QuickAccessEmojiPicker({ value, onSelect, onClear }: QuickAccessEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pasted = looksLikeEmoji(query) ? firstGrapheme(query) : '';
  const matches = searchEmoji(query);
  // A pasted emoji leads, and is not repeated if the palette already has it.
  const results: EmojiEntry[] = pasted
    ? [{ char: pasted, keywords: ['pasted'] }, ...matches.filter((entry) => entry.char !== pasted)]
    : matches;
  const searching = query.trim().length > 0;

  const choose = (char: string) => {
    onSelect(char);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  // Roving focus across the grid — hundreds of buttons in the tab order would
  // bury the rest of the dialog behind them.
  const handleGridKeyDown = (event: React.KeyboardEvent, index: number, cells: number) => {
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? GRID_COLUMNS
            : event.key === 'ArrowUp'
              ? -GRID_COLUMNS
              : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(Math.max(index + step, 0), cells - 1);
    gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-emoji-cell]')[next]?.focus();
  };

  const renderCell = (entry: EmojiEntry, index: number, cells: number) => (
    <button
      key={`${entry.char}-${index}`}
      type="button"
      data-emoji-cell
      aria-label={emojiLabel(entry)}
      aria-pressed={entry.char === value}
      tabIndex={index === 0 ? 0 : -1}
      onKeyDown={(event) => handleGridKeyDown(event, index, cells)}
      onClick={() => choose(entry.char)}
      title={emojiLabel(entry)}
      className={`flex h-7 w-7 items-center justify-center rounded text-[17px] leading-none transition-colors ${
        entry.char === value ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-white/10'
      }`}
    >
      {entry.char}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
          Or an emoji
        </span>
        <button
          ref={triggerRef}
          type="button"
          data-testid="quick-access-icon-emoji"
          aria-expanded={open}
          aria-label={value ? `Emoji ${value}, change it` : 'Choose an emoji'}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className="flex h-9 w-14 items-center justify-center gap-1 rounded border border-border-dark bg-editor-bg text-lg transition-colors hover:border-primary/40"
        >
          {value || <span className="text-[11px] text-foreground-muted">Pick</span>}
          <AuricIcon
            name="expand_more"
            aria-hidden="true"
            className="text-[14px] text-foreground-muted"
          />
        </button>
        {value && (
          <button
            type="button"
            data-testid="quick-access-icon-emoji-clear"
            onClick={onClear}
            className="rounded p-1 text-foreground-muted transition-colors hover:text-foreground"
            aria-label="Remove the emoji"
          >
            <AuricIcon name="close" aria-hidden="true" className="text-[14px]" />
          </button>
        )}
      </div>

      {open && (
        <div
          data-testid="quick-access-emoji-panel"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Stops the dialog behind this from closing too — the first
            // Escape belongs to the thing that just opened.
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className="rounded-lg border border-white/10 bg-black/20 p-2"
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, or paste any emoji"
            aria-label="Search emoji"
            data-testid="quick-access-emoji-search"
            className="mb-2 w-full rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-[11px] text-foreground placeholder:text-foreground-muted/60 focus:border-primary focus:outline-none"
          />
          <div ref={gridRef} className="max-h-52 overflow-y-auto pr-1">
            {searching ? (
              results.length > 0 ? (
                <div className="grid grid-cols-10 gap-0.5">
                  {results.map((entry, index) => renderCell(entry, index, results.length))}
                </div>
              ) : (
                <p className="px-1 py-3 text-[11px] text-foreground-muted/70">
                  Nothing matches. Paste an emoji here to use it anyway.
                </p>
              )
            ) : (
              EMOJI_GROUPS.map((group) => (
                <div key={group.name} className="mb-2">
                  <p className="mb-1 px-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground-muted/50">
                    {group.name}
                  </p>
                  <div className="grid grid-cols-10 gap-0.5">
                    {group.entries.map((entry) =>
                      renderCell(entry, ALL_EMOJI.indexOf(entry), ALL_EMOJI.length)
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
