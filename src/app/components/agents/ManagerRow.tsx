'use client';

import type { MouseEvent, ReactNode } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { formatAgentDuration } from '@/lib/agents/duration';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { ManagerInspector } from './ManagerInspector';

export const ROW_MORE_BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100';

/** Where a menu opens when it is asked for: the pointer, or the corner of the button. */
export interface MenuPoint {
  x: number;
  y: number;
}

/** The "…" that makes a context menu discoverable. Hidden until the row is hovered or focused. */
export function MoreActionsButton({
  label,
  revealed,
  onOpen,
}: {
  label: string;
  revealed: boolean;
  onOpen: (point: MenuPoint) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      title="More actions"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        onOpen({ x: box.right, y: box.bottom });
      }}
      className={`${ROW_MORE_BUTTON} ${revealed ? '' : 'opacity-0'}`}
    >
      <AuricIcon name="more_horiz" aria-hidden="true" className="text-[16px]" />
    </button>
  );
}

interface ManagerRowProps {
  manager: SupervisorManager;
  run: SupervisorRun;
  now: number;
  /** The supervisor working in the manager's folder: what makes the dot light up. */
  liveSupervisor: AgentInfo | undefined;
  /** Archived rows have no inspector; a click opens their menu instead. */
  archived: boolean;
  expanded: boolean;
  folderOpen: boolean;
  /** The folder's files, drawn under the inspector while the folder is open. */
  files: ReactNode;
  reloadToken: number;
  onToggle: () => void;
  onToggleFolder: () => void;
  onMenu: (point: MenuPoint) => void;
  onOpen: () => void;
  onEditInstructions: () => void;
  onRestart: () => void;
}

function Status({ live, archived, ago }: { live: boolean; archived: boolean; ago: string | null }) {
  if (live) return <span className="text-primary">Running</span>;
  const age = ago === null ? null : `${ago} ago`;
  return <>{archived ? ['Archived', age].filter(Boolean).join(' · ') : (age ?? 'Not started')}</>;
}

/**
 * A Project Manager in the runs rail. Managers do not move when they are used:
 * the row shows whether the manager is working, never when it last was.
 */
export function ManagerRow({
  manager,
  run,
  now,
  liveSupervisor,
  archived,
  expanded,
  folderOpen,
  files,
  reloadToken,
  onToggle,
  onToggleFolder,
  onMenu,
  onOpen,
  onEditInstructions,
  onRestart,
}: ManagerRowProps) {
  const live = liveSupervisor !== undefined;
  const ago = run.modifiedAtMs === null ? null : formatAgentDuration(now - run.modifiedAtMs);
  return (
    <li data-testid="manager-row">
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY });
        }}
        className={`group flex items-center gap-1.5 px-3 py-1 text-sm transition-colors ${
          expanded
            ? 'bg-primary/10 text-foreground'
            : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
        }`}
      >
        <button
          type="button"
          onClick={(event) =>
            archived ? onMenu({ x: event.clientX, y: event.clientY }) : onToggle()
          }
          aria-expanded={archived ? undefined : expanded}
          aria-haspopup={archived ? 'menu' : undefined}
          title={run.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <AuricIcon
            name={expanded ? 'expand_more' : 'chevron_right'}
            aria-hidden="true"
            className={`shrink-0 text-[15px] ${archived ? 'invisible' : ''}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  live
                    ? 'bg-primary shadow-[0_0_6px_var(--primary)]'
                    : 'border border-foreground-muted/60'
                }`}
              />
              <span className={`truncate ${archived ? 'text-foreground-muted' : ''}`}>
                {manager.name}
              </span>
            </span>
            <span className="block truncate pl-3 text-[11px] text-foreground-muted">
              <Status live={live} archived={archived} ago={ago} />
            </span>
          </span>
        </button>
        <MoreActionsButton
          label={`More actions for ${manager.name}`}
          revealed={expanded}
          onOpen={onMenu}
        />
      </div>
      {expanded && !archived && (
        <>
          <ManagerInspector
            manager={manager}
            run={run}
            liveSupervisor={liveSupervisor}
            folderOpen={folderOpen}
            reloadToken={reloadToken}
            onOpen={onOpen}
            onEditInstructions={onEditInstructions}
            onRestart={onRestart}
            onToggleFolder={onToggleFolder}
          />
          {folderOpen && files}
        </>
      )}
    </li>
  );
}
