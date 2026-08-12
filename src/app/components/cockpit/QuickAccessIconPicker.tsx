'use client';

import { useRef } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { QUICK_ACCESS_GLYPHS } from '@/lib/quickAccess/glyphs';
import type { ProjectIconOverride } from '@/lib/store/starredProjectsSlice';
import { ProjectTileFace } from './ProjectTileFace';
import { QuickAccessEmojiPicker } from './QuickAccessEmojiPicker';
import { QuickAccessFaviconFinder } from './QuickAccessFaviconFinder';

const GRID_COLUMNS = 8;

interface QuickAccessIconPickerProps {
  path: string;
  value?: ProjectIconOverride;
  onChange: (icon: ProjectIconOverride | undefined) => void;
  onAnnounce: (message: string) => void;
}

/**
 * Picks the mark drawn on a project's tile: a glyph from the curated set, a
 * single emoji, or nothing (the generated initials). The three are one union,
 * so mutual exclusion is structural rather than a rule to remember.
 */
export function QuickAccessIconPicker({
  path,
  value,
  onChange,
  onAnnounce,
}: QuickAccessIconPickerProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedGlyph = value?.kind === 'glyph' ? value.value : null;
  const emoji = value?.kind === 'emoji' ? value.value : '';

  // Roving tabindex: fifty buttons sitting in the tab order would be a
  // keyboard trap in spirit if not in letter.
  const handleGridKeyDown = (event: React.KeyboardEvent, index: number) => {
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
    const next = Math.min(Math.max(index + step, 0), QUICK_ACCESS_GLYPHS.length - 1);
    gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <SettingsSection title="Tile Icon" icon="palette">
      <div className="flex items-center gap-4">
        {/* The real tile face, not a mock-up of it. */}
        <ProjectTileFace path={path} icon={value} />
        <button
          type="button"
          data-testid="quick-access-icon-reset"
          disabled={!value}
          onClick={() => {
            onChange(undefined);
            onAnnounce('Using the generated initials');
          }}
          className="rounded bg-white/5 px-3 py-1.5 text-[11px] text-foreground-muted transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use initials
        </button>
      </div>

      <div
        ref={gridRef}
        role="radiogroup"
        aria-label="Tile glyph"
        data-testid="quick-access-glyph-grid"
        className="grid grid-cols-8 gap-1"
      >
        {QUICK_ACCESS_GLYPHS.map((name, index) => {
          const selected = selectedGlyph === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name.replace(/_/g, ' ')}
              tabIndex={selected || (!selectedGlyph && index === 0) ? 0 : -1}
              onKeyDown={(event) => handleGridKeyDown(event, index)}
              onClick={() => {
                onChange({ kind: 'glyph', value: name });
                onAnnounce(`${name.replace(/_/g, ' ')} selected`);
              }}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                selected
                  ? 'border-primary/60 bg-primary/15 text-primary-light'
                  : 'border-white/5 text-foreground-muted hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <AuricIcon name={name} aria-hidden="true" className="text-[16px]" />
            </button>
          );
        })}
      </div>

      <QuickAccessFaviconFinder
        projectPath={path}
        value={value?.kind === 'image' ? value.value : ''}
        onSelect={(file) => {
          onChange({ kind: 'image', value: file });
          onAnnounce(`Using ${file.split('/').pop()} as the tile icon`);
        }}
      />

      <QuickAccessEmojiPicker
        value={emoji}
        onSelect={(char) => {
          onChange({ kind: 'emoji', value: char });
          onAnnounce(`Emoji ${char} selected`);
        }}
        onClear={() => {
          onChange(undefined);
          onAnnounce('Using the generated initials');
        }}
      />
    </SettingsSection>
  );
}
