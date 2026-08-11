'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { generateProjectIcon } from '@/lib/projectIcon';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Hold-to-confirm threshold for unstarring — long enough to rule out an
 * accidental tap, short enough to still feel immediate once committed to. */
const HOLD_MS = 550;
/** How long the tile's exit animation plays before it actually leaves the store. */
const EXIT_MS = 180;

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface ProjectTileProps {
  project: StarredProject;
  active: boolean;
  onSwitch: () => void;
  onUnstar: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ProjectTile({ project, active, onSwitch, onUnstar, onContextMenu }: ProjectTileProps) {
  const icon = generateProjectIcon(project.path);
  const [holding, setHolding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    if (holdTimer.current || removing) return;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHolding(false);
      // Confirmed: play the exit animation, then actually unstar — nothing
      // should just vanish mid-frame.
      setRemoving(true);
      setTimeout(onUnstar, EXIT_MS);
    }, HOLD_MS);
  };

  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  };

  return (
    <div
      data-testid={`quick-access-item-${project.path}`}
      className={`group/tile relative flex w-20 flex-col items-center gap-1.5 quick-access-tile-enter ${
        removing ? 'quick-access-tile-exit' : ''
      }`}
    >
      <button
        type="button"
        data-testid={`quick-access-tile-${project.path}`}
        data-active={active}
        onClick={onSwitch}
        onContextMenu={onContextMenu}
        title={active ? `${project.name} (current)` : `Switch to ${project.name}`}
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-black text-white/95 shadow-sm transition-[transform,box-shadow] duration-150 active:scale-[0.94] ${
          active
            ? 'ring-2 ring-primary/70 ring-offset-2 ring-offset-background'
            : 'ring-1 ring-white/10 hover:ring-white/25 hover:shadow-[0_0_16px_rgba(var(--primary-rgb),0.18)]'
        }`}
        style={{
          backgroundImage: `linear-gradient(135deg, ${icon.gradientFrom}, ${icon.gradientTo})`,
        }}
      >
        {icon.initials}
      </button>
      <span
        title={project.name}
        className="max-w-full truncate text-[10px] font-medium text-foreground-muted"
      >
        {project.name}
      </span>
      <button
        type="button"
        data-testid={`quick-access-unstar-${project.path}`}
        data-holding={holding}
        onPointerDown={(e) => {
          e.stopPropagation();
          startHold();
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            startHold();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') cancelHold();
        }}
        title={holding ? 'Keep holding to remove…' : `Hold to remove ${project.name}`}
        aria-label={`Hold to remove ${project.name} from Quick Access`}
        className={`absolute -right-0.5 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-background text-foreground-muted opacity-0 transition-[opacity,transform,color] duration-150 group-hover/tile:opacity-100 focus-visible:opacity-100 ${
          holding ? 'scale-90 text-red-400' : 'hover:text-foreground'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="absolute inset-0 -rotate-90"
          style={{ opacity: holding ? 1 : 0, transition: 'opacity 150ms ease-out' }}
        >
          <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={holding ? 0 : RING_CIRCUMFERENCE}
            style={{
              transition: holding
                ? `stroke-dashoffset ${HOLD_MS}ms linear`
                : 'stroke-dashoffset 150ms ease-out',
            }}
          />
        </svg>
        <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
      </button>
    </div>
  );
}

export interface QuickAccessProps {
  /** The currently open project's path, used to highlight/star the active tile. */
  currentPath: string | null;
  /** Switch to another project by path (reuses the recent-project open flow). */
  onSwitchProject?: (path: string) => void;
}

/**
 * Quick Access — a stable grid of starred projects ("apps") in Mission Control,
 * for one-click switching between workspaces. Tiles are sorted alphabetically
 * by name — a predictable order that stays put across sessions (names change
 * far less often than recency), so muscle memory and spatial locality hold
 * without the row reshuffling. Unstarring requires a deliberate hold (not a
 * single tap) so a stray click can't silently drop a tile.
 */
export function QuickAccess({ currentPath, onSwitchProject }: QuickAccessProps) {
  const starredProjects = useStore((s) => s.starredProjects);
  const removeStarredProject = useStore((s) => s.removeStarredProject);
  const addStarredProject = useStore((s) => s.addStarredProject);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const setSpawnAgentRepoPath = useStore((s) => s.setSpawnAgentRepoPath);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);
  const setSpawnAgentGoalId = useStore((s) => s.setSpawnAgentGoalId);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  );

  const menuOptions: ContextMenuOption[] = contextMenu
    ? [
        {
          label: 'Start Agent',
          icon: 'bolt',
          action: () => {
            setSpawnAgentTicketId(null);
            setSpawnAgentGoalId(null);
            setInitialAgentTask('');
            setSpawnAgentRepoPath(contextMenu.path);
            setSpawnDialogOpen(true);
          },
        },
        {
          label: 'Copy Working Directory',
          icon: 'content_copy',
          action: () => {
            navigator.clipboard.writeText(contextMenu.path);
          },
        },
      ]
    : [];

  const sortedProjects = [...starredProjects].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  );

  const currentStarred =
    currentPath !== null && starredProjects.some((p) => p.path === currentPath);
  const canStarCurrent = currentPath !== null && !currentStarred;

  return (
    <div data-testid="quick-access" className="flex w-full max-w-3xl flex-col items-center gap-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Quick Access
        </p>
        {starredProjects.length > 0 && (
          <span
            data-testid="quick-access-hint"
            className="text-[9px] font-normal normal-case tracking-normal text-foreground-muted/50"
          >
            (hold × to remove)
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-4">
        {starredProjects.length === 0 && !canStarCurrent && (
          <p className="text-[11px] text-foreground-muted/70">
            No starred projects yet. Star one from Recent Projects.
          </p>
        )}
        {sortedProjects.map((project) => (
          <ProjectTile
            key={project.path}
            project={project}
            active={project.path === currentPath}
            onSwitch={() => {
              if (project.path !== currentPath) onSwitchProject?.(project.path);
            }}
            onUnstar={() => removeStarredProject(project.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, path: project.path });
            }}
          />
        ))}
        {canStarCurrent && (
          <div className="flex w-20 flex-col items-center gap-1.5 quick-access-tile-enter">
            <button
              type="button"
              data-testid="quick-access-add-current"
              onClick={() => addStarredProject(currentPath)}
              title="Star this project for quick access"
              className="group/star flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-white/15 text-foreground-muted transition-[background-color,border-color,color] duration-150 hover:border-primary/40 hover:bg-primary/5 hover:text-primary-light active:scale-[0.94]"
            >
              <AuricIcon
                name="star"
                aria-hidden="true"
                className="text-[18px] transition-transform duration-150 group-hover/star:scale-110"
              />
            </button>
            <span className="max-w-full truncate text-[10px] font-medium text-foreground-muted">
              {starredProjects.length === 0 ? 'Star this' : 'Add'}
            </span>
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={menuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
