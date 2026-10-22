'use client';

import type { MouseEvent } from 'react';
import { managerMonogram, type ManagerStatus } from '@/lib/agents/managerStatus';

interface ManagerTileProps {
  name: string;
  /** The address the tile is found by in tests and the accessibility tree. */
  managerKey: string;
  status: ManagerStatus;
  /** The manager is being started: the click is already handled. */
  opening: boolean;
  onOpen: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

const STATUS_WORDS: Record<ManagerStatus, string> = {
  idle: 'not running',
  running: 'running',
  attention: 'needs you',
};

/** Status owns the dot: the accent while it works, amber when it waits for the human. */
const DOT_CLASS: Partial<Record<ManagerStatus, string>> = {
  running: 'bg-primary',
  attention: 'bg-amber-400',
};

/**
 * A Project Manager in Quick Access: a monogram from its name, the name, and a
 * dot while a session works. Click opens it, or brings the running session
 * forward. No skill wheel: a skill starts a new supervisor, and a manager has
 * exactly one.
 */
export function ManagerTile({
  name,
  managerKey,
  status,
  opening,
  onOpen,
  onContextMenu,
}: ManagerTileProps) {
  const dot = DOT_CLASS[status];
  return (
    <div
      data-testid={`quick-access-manager-item-${managerKey}`}
      className="relative flex w-20 flex-col items-center gap-1.5"
    >
      <div className="relative h-10 w-10">
        <button
          type="button"
          data-testid={`quick-access-manager-${managerKey}`}
          data-status={status}
          onClick={onOpen}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu(event);
          }}
          disabled={opening}
          aria-busy={opening}
          aria-label={`${name}, ${STATUS_WORDS[status]}`}
          title={opening ? `Opening ${name}…` : `${name}, ${STATUS_WORDS[status]}`}
          className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-white/15 via-white/[0.06] to-transparent text-primary-light shadow-sm ring-1 ring-white/10 transition-[transform,box-shadow] duration-150 hover:shadow-[0_0_16px_rgba(var(--primary-rgb),0.18)] hover:ring-white/25 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:cursor-progress disabled:opacity-70"
        >
          <span aria-hidden="true" className="text-[13px] font-semibold tracking-wide">
            {managerMonogram(name)}
          </span>
          {dot && (
            <span
              aria-hidden="true"
              data-testid={`quick-access-manager-dot-${managerKey}`}
              className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full shadow-[0_0_0_2px_var(--background)] ${dot}`}
            />
          )}
        </button>
      </div>
      <span
        title={name}
        className="max-w-full truncate text-[10px] font-medium text-foreground-muted"
      >
        {name}
      </span>
    </div>
  );
}
