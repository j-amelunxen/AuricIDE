'use client';

import { useState } from 'react';
import { AGENT_COLORS, type AgentColor } from '@/lib/agents/colors';
import {
  badgeChipStyle,
  initialBadgeColor,
  normalizeProjectBadge,
  usedBadges,
} from '@/lib/quickAccess/badge';
import { useStore } from '@/lib/store';
import type { ProjectBadge, StarredProject } from '@/lib/tauri/starredProjects';

interface ProjectBadgeFieldProps {
  project: StarredProject;
  /** Closes the menu. Setting and clearing both end the gesture. */
  onDone: () => void;
}

function sameText(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * The badge editor that lives in the right-click menu. A temporary flag is
 * typed and confirmed with Enter, or picked from a tag already in use.
 * Nothing here opens a second dialog.
 */
export function ProjectBadgeField({ project, onDone }: ProjectBadgeFieldProps) {
  const setStarredProjectBadge = useStore((s) => s.setStarredProjectBadge);
  const starredProjects = useStore((s) => s.starredProjects);
  const inUse = usedBadges(starredProjects);
  const [text, setText] = useState(project.badge?.text ?? '');
  const [color, setColor] = useState<AgentColor>(() =>
    initialBadgeColor(
      project.badge?.color,
      starredProjects.flatMap((other) =>
        other.path === project.path || !other.badge?.color ? [] : [other.badge.color]
      )
    )
  );

  const apply = (badge: ProjectBadge | null) => {
    setStarredProjectBadge(project.path, badge);
    onDone();
  };

  const commitText = (raw: string, nextColor: string) => {
    const normalized = normalizeProjectBadge({ text: raw, color: nextColor });
    if (!normalized && !project.badge) {
      onDone();
      return;
    }
    apply(normalized);
  };

  return (
    <form
      data-testid="quick-access-badge-form"
      onSubmit={(event) => {
        event.preventDefault();
        commitText(text, color);
      }}
      className="flex flex-col gap-2 px-2 py-2"
    >
      <input
        data-testid="quick-access-badge-input"
        aria-label="Badge text"
        value={text}
        maxLength={6}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="Tag, then Enter"
        onChange={(event) => setText(event.target.value)}
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
      />
      <div role="group" aria-label="Badge color" className="flex gap-1.5">
        {AGENT_COLORS.map((option) => {
          const selected = option.key === color;
          return (
            <button
              key={option.key}
              type="button"
              aria-label={option.label}
              aria-pressed={selected}
              data-testid={`quick-access-badge-color-${option.key}`}
              onClick={() => {
                setColor(option.key);
                // A colour click is the mouse's Enter: the text is already there.
                if (text.trim()) commitText(text, option.key);
              }}
              className={`h-4 w-4 rounded-full transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light ${
                selected
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-surface'
                  : 'opacity-70 hover:opacity-100'
              }`}
              style={{ backgroundColor: option.hex }}
            />
          );
        })}
      </div>
      {inUse.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {inUse.map((badge) => {
            const active = sameText(project.badge?.text, badge.text);
            return (
              <button
                key={badge.text}
                type="button"
                aria-pressed={active}
                aria-label={active ? `Clear ${badge.text}` : `Use ${badge.text}`}
                onClick={() => apply(active ? null : badge)}
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none"
                style={badgeChipStyle(badge.color)}
              >
                {badge.text}
              </button>
            );
          })}
        </div>
      )}
    </form>
  );
}
