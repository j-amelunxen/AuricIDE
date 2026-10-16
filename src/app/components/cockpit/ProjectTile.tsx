'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  quickAccessCombos,
  quickAccessWheelSlots,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { launchEntriesForProject } from '@/lib/quickAccess/launchSkills';
import { badgeChipStyle, normalizeProjectBadge } from '@/lib/quickAccess/badge';
import { ProjectTileFace } from './ProjectTileFace';
import { useLaunchWheel } from './useLaunchWheel';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Hold-to-confirm threshold for unstarring — long enough to rule out an
 * accidental tap, short enough to still feel immediate once committed to. */
const HOLD_MS = 550;
/** How long the tile's exit animation plays before it actually leaves the store. */
const EXIT_MS = 180;

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ProjectTileProps {
  project: StarredProject;
  active: boolean;
  dirty: boolean;
  wheelSuppressed: boolean;
  onSwitch: () => void;
  onUnstar: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onLaunchSkill: (skill: QuickAccessSkill) => void;
  onLaunchCombo: (combo: QuickAccessCombo) => void;
  onOpenSettings: () => void;
  onWheelActivity: (active: boolean) => void;
  /**
   * Makes the tile draggable (grid to dock, inside the dock, dock to grid). The
   * drag is on the outer item, not the button: the button owns pointer capture
   * for the hold wheel. Absent means the tile is not draggable.
   */
  drag?: {
    onDragStart: (event: React.DragEvent) => void;
    /** Left out where the tile is no drop target itself (the grid takes it over). */
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

export function ProjectTile({
  project,
  active,
  dirty,
  wheelSuppressed,
  onSwitch,
  onUnstar,
  onContextMenu,
  onLaunchSkill,
  onLaunchCombo,
  onOpenSettings,
  onWheelActivity,
  drag,
}: ProjectTileProps) {
  const badge = normalizeProjectBadge(project.badge);
  const label = [
    active ? `${project.name} (current)` : `Switch to ${project.name}`,
    badge ? `badge ${badge.text}` : null,
    dirty ? 'uncommitted changes' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const [holding, setHolding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setStarredProjectWheelSlots = useStore((s) => s.setStarredProjectWheelSlots);
  const setStarredProjectBadge = useStore((s) => s.setStarredProjectBadge);
  const {
    tileRef,
    dispatch: wheelDispatch,
    wheelLive,
    wheelGrabbed,
    consumedClick,
    containerHandlers,
    buttonHandlers,
    wheel,
    pickerMenu,
  } = useLaunchWheel({
    wheelId: project.path,
    entries: launchEntriesForProject(project),
    storedSlots: quickAccessWheelSlots(project),
    writeSlots: (slots) => setStarredProjectWheelSlots(project.path, slots),
    onLaunch: (entry) => {
      if (entry.kind === 'combo') onLaunchCombo(entry.combo);
      else onLaunchSkill(entry.skill);
    },
    onConfigure: onOpenSettings,
    suppressed: wheelSuppressed,
    onActivity: onWheelActivity,
  });

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
      draggable={drag !== undefined}
      onDragStart={(event) => {
        cancelHold();
        wheelDispatch({ type: 'cancel' });
        drag?.onDragStart(event);
      }}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      {...containerHandlers}
      className={`group/tile relative flex w-20 flex-col items-center gap-1.5 quick-access-tile-enter ${
        removing ? 'quick-access-tile-exit' : ''
      } ${wheelLive ? 'z-20' : ''}`}
    >
      <div className="relative h-10 w-10">
        <button
          ref={tileRef}
          type="button"
          data-testid={`quick-access-tile-${project.path}`}
          data-active={active}
          onClick={() => {
            if (consumedClick) return;
            onSwitch();
          }}
          onContextMenu={onContextMenu}
          {...buttonHandlers}
          // The description rides along as the hover's second line: it is what
          // agents read about this project, and a tile has no room for prose.
          title={project.description ? `${label}\n${project.description}` : label}
          // A glyph or emoji tile has no text content of its own, so the name
          // has to be stated rather than left to the title attribute.
          aria-label={label}
          className={`relative flex h-10 w-10 items-center justify-center rounded-xl shadow-sm transition-[transform,box-shadow] duration-150 active:scale-[0.94] ${
            active
              ? 'ring-2 ring-primary/70 ring-offset-2 ring-offset-background'
              : 'ring-1 ring-white/10 hover:ring-white/25 hover:shadow-[0_0_16px_rgba(var(--primary-rgb),0.18)]'
          }`}
        >
          <ProjectTileFace path={project.path} icon={project.icon} />
          {dirty && (
            <span
              data-testid={`quick-access-dirty-${project.path}`}
              title="Uncommitted changes"
              aria-hidden="true"
              // Top-right: bottom-left is the combo mark, bottom-right is the
              // remove ×. A status pip belongs on the free corner, and a ring
              // of the tile's own background keeps amber readable on any hue.
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_0_2px_var(--background)]"
            />
          )}
          {quickAccessCombos(project).length > 0 && (
            <span
              data-testid={`quick-access-combo-mark-${project.path}`}
              aria-hidden="true"
              // Bottom-left: the opposite bottom corner belongs to the remove ×,
              // and two badges in one corner would cover each other.
              className="absolute -bottom-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold leading-none text-white shadow"
            >
              +
            </span>
          )}
        </button>
        {wheel}
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
          // On the icon's own bottom-right corner, not on the 80px column
          // around it — out there it sat in the gutter between two tiles and
          // read as belonging to neither. Muted red because it removes
          // something; saturated red would shout at a row that is mostly at
          // rest, so the colour only comes up on hover and on the hold.
          className={`absolute -bottom-1.5 -right-1.5 z-40 flex h-5 w-5 items-center justify-center rounded-full border border-red-300/20 bg-background opacity-0 transition-[opacity,transform,color] duration-150 focus-visible:opacity-100 ${
            wheelGrabbed ? 'pointer-events-none' : 'group-hover/tile:opacity-100'
          } ${holding ? 'scale-90 text-red-400' : 'text-red-300/80 hover:text-red-300'}`}
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
      {badge && (
        <span
          data-testid={`quick-access-badge-${project.path}`}
          data-color={badge.color}
          // Colour stays on this chip. The ring means "open" and the amber dot
          // means "uncommitted"; painting either of those would change what the
          // tile claims. The × is always there: these marks are temporary.
          className="inline-flex max-w-full items-center gap-0.5 rounded py-0.5 pr-0.5 pl-1.5 text-[11px] font-semibold leading-none"
          style={badgeChipStyle(badge.color)}
        >
          <button
            type="button"
            title={badge.text}
            aria-label={`Edit badge ${badge.text}`}
            onClick={(event) => {
              event.stopPropagation();
              onContextMenu(event);
            }}
            className="min-w-0 truncate"
          >
            {badge.text}
          </button>
          <button
            type="button"
            data-testid={`quick-access-badge-remove-${project.path}`}
            aria-label={`Remove badge ${badge.text}`}
            title="Remove badge"
            onClick={(event) => {
              event.stopPropagation();
              setStarredProjectBadge(project.path, null);
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-black/25"
          >
            <AuricIcon name="close" aria-hidden="true" className="text-[10px]" />
          </button>
        </span>
      )}
      <span
        title={project.name}
        className="max-w-full truncate text-[10px] font-medium text-foreground-muted"
      >
        {project.name}
      </span>
      {pickerMenu}
    </div>
  );
}
