'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import {
  quickAccessCombos,
  quickAccessSkills,
  quickAccessWheelSlots,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { comboMenuLabel } from '@/lib/quickAccess/combo';
import {
  launchEntriesForProject,
  resolveWheelEntry,
  wheelEntryLabel,
  wheelEntryName,
  wheelKnownIds,
  wheelSlotId,
} from '@/lib/quickAccess/launchSkills';
import { useSpawnLauncher } from '@/lib/quickAccess/useSpawnLauncher';
import {
  assignSkillToSlot,
  clearWheelSlot,
  normalizeWheelSlots,
  slotIndexAt,
  wheelSlotChoices,
} from '@/lib/quickAccess/wheel';
import { ProjectTileFace } from './ProjectTileFace';
import { PROJECT_TILE_COLUMNS, PROJECT_TILE_GRID } from './projectGrid';
import { QuickAccessSettingsDialog } from './QuickAccessSettingsDialog';
import { SkillWheel, useSkillWheel } from './SkillWheel';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Hold-to-confirm threshold for unstarring — long enough to rule out an
 * accidental tap, short enough to still feel immediate once committed to. */
const HOLD_MS = 550;
/** How long the tile's exit animation plays before it actually leaves the store. */
const EXIT_MS = 180;

/**
 * Past this many, a right-click menu stops being a shortcut and starts being
 * a list. The rest stay one click away in the settings dialog.
 */
const MAX_MENU_SKILLS = 8;

/**
 * Shown by whoever owns the header above the tiles, because removing is not
 * discoverable from an × that ignores a click. It lives here, next to the hold
 * that implements it, so the two cannot drift apart.
 */
export const QUICK_ACCESS_HINT = 'hold × to remove';

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface ProjectTileProps {
  project: StarredProject;
  active: boolean;
  wheelSuppressed: boolean;
  onSwitch: () => void;
  onUnstar: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onLaunchSkill: (skill: QuickAccessSkill) => void;
  onLaunchCombo: (combo: QuickAccessCombo) => void;
  onOpenSettings: () => void;
  onWheelActivity: (active: boolean) => void;
}

function ProjectTile({
  project,
  active,
  wheelSuppressed,
  onSwitch,
  onUnstar,
  onContextMenu,
  onLaunchSkill,
  onLaunchCombo,
  onOpenSettings,
  onWheelActivity,
}: ProjectTileProps) {
  const label = active ? `${project.name} (current)` : `Switch to ${project.name}`;
  const [holding, setHolding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tileRef = useRef<HTMLButtonElement>(null);
  const { machine, dispatch } = useSkillWheel(wheelSuppressed);
  const setStarredProjectWheelSlots = useStore((s) => s.setStarredProjectWheelSlots);
  // 'assign' picks what goes on the slot, 'manage' acts on what is already
  // there. Both keep the wheel pinned open while they are up.
  const [picker, setPicker] = useState<{
    slot: number;
    x: number;
    y: number;
    mode: 'assign' | 'manage';
  } | null>(null);
  const pickerHandover = useRef(false);

  const entries = launchEntriesForProject(project);
  const knownIds = wheelKnownIds(project);
  const slotIds = normalizeWheelSlots(quickAccessWheelSlots(project), knownIds);
  const slotted = slotIds.map((id) => resolveWheelEntry(project, id));

  const wheelLive = machine.phase !== 'idle' || machine.mode !== 'none';
  // Hovering a tile does two things at once: it reveals the remove ×, and it
  // starts the wheel's dwell. Gating the × on "the wheel is doing something"
  // meant the dwell hid it from the first frame of every hover, and the wheel
  // opens 300ms in and never closes while the pointer rests there — so the ×
  // was unreachable by pointer, full stop. It now yields only to an actual
  // hold gesture, where a release could otherwise land on it by accident.
  const wheelGrabbed = machine.mode === 'hold';
  const onWheelActivityRef = useRef(onWheelActivity);
  useEffect(() => {
    onWheelActivityRef.current = onWheelActivity;
  }, [onWheelActivity]);
  useEffect(() => {
    onWheelActivityRef.current(wheelLive);
  }, [wheelLive]);

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

  const aimFromPointer = (event: React.PointerEvent) => {
    const slotEl = (event.target as HTMLElement | null)?.closest?.('[data-wheel-slot]');
    if (slotEl instanceof HTMLElement && slotEl.dataset.wheelSlot !== undefined) {
      dispatch({ type: 'aim', slot: Number(slotEl.dataset.wheelSlot) });
      return;
    }
    const origin = tileRef.current;
    if (!origin) return;
    const rect = origin.getBoundingClientRect();
    dispatch({
      type: 'aim',
      slot: slotIndexAt(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2)
      ),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const action = dispatch({ type: 'up', now: event.timeStamp });
    if (action.type === 'hold-release' && action.slot !== null) {
      launchEntry(slotted[action.slot]);
    }
  };

  const launchEntry = (entry: (typeof slotted)[number]) => {
    if (!entry) return;
    if (entry.kind === 'combo') onLaunchCombo(entry.combo);
    else onLaunchSkill(entry.skill);
  };

  const byId = (id: string) => entries.find((entry) => wheelSlotId(entry) === id) ?? null;
  const resolveChoices = (ids: { id: string }[]) =>
    ids
      .map((choice) => byId(choice.id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const choices = picker
    ? wheelSlotChoices(
        entries.map((entry) => ({ id: wheelSlotId(entry), label: wheelEntryLabel(entry) })),
        slotIds,
        picker.slot
      )
    : { free: [], placed: [] };
  const freeEntries = resolveChoices(choices.free);
  const placedEntries = resolveChoices(choices.placed);

  const writeSlots = (slots: (string | null)[]) => setStarredProjectWheelSlots(project.path, slots);

  const assignEntry = (entry: (typeof freeEntries)[number]) => {
    if (!picker) return;
    writeSlots(assignSkillToSlot(slotIds, picker.slot, wheelSlotId(entry), knownIds));
  };

  const entryOption = (entry: (typeof freeEntries)[number]): ContextMenuOption => ({
    label: wheelEntryLabel(entry),
    icon: entry.kind === 'combo' ? 'account_tree' : 'auto_awesome',
    action: () => assignEntry(entry),
  });

  const assignMenuOptions = (): ContextMenuOption[] => {
    if (freeEntries.length === 0 && placedEntries.length === 0) {
      return [
        {
          label: entries.length === 0 ? 'Configure skills…' : 'Nothing left to put here',
          icon: 'settings',
          action: () => {
            if (entries.length === 0) onOpenSettings();
          },
        },
      ];
    }
    const combos = freeEntries.filter((entry) => entry.kind === 'combo');
    const skills = freeEntries.filter((entry) => entry.kind === 'skill');
    const options: ContextMenuOption[] = [];
    if (combos.length > 0) {
      options.push({ type: 'header', label: 'Combos' }, ...combos.map(entryOption));
    }
    if (combos.length > 0 && skills.length > 0) {
      options.push({ type: 'separator' });
    }
    if (skills.length > 0) {
      options.push({ type: 'header', label: 'Skills' }, ...skills.map(entryOption));
    }
    // Moving one here empties the slot it came from — or swaps, if this slot is
    // taken. Either way nothing is lost, so it sits in the same list.
    if (placedEntries.length > 0) {
      if (options.length > 0) options.push({ type: 'separator' });
      options.push(
        { type: 'header', label: 'Already on the wheel' },
        ...placedEntries.map(entryOption)
      );
    }
    return options;
  };

  const manageMenuOptions = (): ContextMenuOption[] => {
    const entry = picker ? slotted[picker.slot] : null;
    if (!entry || !picker) return [];
    return [
      { type: 'header', label: wheelEntryName(entry) },
      {
        label: 'Replace with…',
        icon: 'move_item',
        action: () => {
          pickerHandover.current = true;
          setPicker({ ...picker, mode: 'assign' });
        },
      },
      {
        label: 'Take off the wheel',
        icon: 'close',
        danger: true,
        action: () => writeSlots(clearWheelSlot(slotIds, picker.slot, knownIds)),
      },
    ];
  };

  return (
    <div
      data-testid={`quick-access-item-${project.path}`}
      onPointerEnter={(event) => dispatch({ type: 'enter', now: event.timeStamp })}
      onPointerMove={(event) => {
        if (machine.mode === 'hold' && machine.phase === 'open') {
          aimFromPointer(event);
          return;
        }
        // A menu that closed while the pointer sat on the tile leaves no enter
        // to come — without this the wheel would stay shut until the pointer
        // crossed the boundary again.
        if (machine.mode === 'none') dispatch({ type: 'enter', now: event.timeStamp });
      }}
      onPointerLeave={(event) => {
        if (picker) return;
        dispatch({ type: 'leave', now: event.timeStamp });
      }}
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
            if (machine.consumedClick) return;
            onSwitch();
          }}
          onContextMenu={onContextMenu}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dispatch({ type: 'down', now: event.timeStamp });
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (machine.mode === 'hold' && machine.phase === 'open') aimFromPointer(event);
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => dispatch({ type: 'cancel' })}
          title={label}
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
        <SkillWheel
          path={project.path}
          phase={machine.phase}
          mode={machine.mode}
          armedSlot={machine.armedSlot}
          slots={slotted}
          onSlotClick={(index) => launchEntry(slotted[index])}
          onPlusClick={(index, x, y) => setPicker({ slot: index, x, y, mode: 'assign' })}
          onSlotManage={(index, x, y) => setPicker({ slot: index, x, y, mode: 'manage' })}
        />
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
      <span
        title={project.name}
        className="max-w-full truncate text-[10px] font-medium text-foreground-muted"
      >
        {project.name}
      </span>
      {picker && (
        <ContextMenu
          // Keyed by mode: swapping the manage menu for the assign one is a new
          // menu, and it has to take focus like one.
          key={picker.mode}
          x={picker.x}
          y={picker.y}
          onClose={() => {
            // ContextMenu closes itself after every action, including the one
            // that only swaps this menu for the other — that swap is not a close.
            if (pickerHandover.current) {
              pickerHandover.current = false;
              return;
            }
            setPicker(null);
            // Reaching the menu already fired the tile's leave, and that one was
            // swallowed to hold the wheel open. Hand it back now, or the wheel
            // has no way left to close.
            dispatch({ type: 'leave', now: performance.now() });
          }}
          options={picker.mode === 'manage' ? manageMenuOptions() : assignMenuOptions()}
        />
      )}
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
 * for one-click switching between workspaces. Hovering a tile dwells into a
 * radial skill wheel; holding the tile skips the dwell and releases onto a
 * slot. Tiles are sorted alphabetically by name — a predictable order that
 * stays put across sessions (names change far less often than recency), so
 * muscle memory and spatial locality hold without the row reshuffling.
 * Unstarring requires a deliberate hold (not a single tap) so a stray click
 * can't drop a tile.
 */
export function QuickAccess({ currentPath, onSwitchProject }: QuickAccessProps) {
  const starredProjects = useStore((s) => s.starredProjects);
  const removeStarredProject = useStore((s) => s.removeStarredProject);
  const addStarredProject = useStore((s) => s.addStarredProject);
  const launchSpawnDialog = useSpawnLauncher();
  const startSkillCombo = useStore((s) => s.startSkillCombo);
  const showToast = useStore((s) => s.showToast);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  );
  // Local, not a uiSlice flag: page.tsx renders either the welcome branch or
  // the IDE branch, so the two QuickAccess instances never coexist, and only
  // this component opens the dialog.
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [wheelPath, setWheelPath] = useState<string | null>(null);

  // Resolved from the store rather than captured, so the dialog keeps editing
  // the live record if it changes underneath.
  const settingsProject = settingsPath
    ? starredProjects.find((p) => p.path === settingsPath)
    : undefined;

  const menuProject = contextMenu
    ? starredProjects.find((p) => p.path === contextMenu.path)
    : undefined;
  const menuSkills = menuProject ? quickAccessSkills(menuProject) : [];
  const shownSkills = menuSkills.slice(0, MAX_MENU_SKILLS);
  const menuCombos = menuProject ? quickAccessCombos(menuProject) : [];
  const shownCombos = menuCombos.slice(0, MAX_MENU_SKILLS);

  /**
   * The one path into the spawn dialog. Everything a previous entry point may
   * have left behind is cleared explicitly — a skill launched in repo B must
   * not inherit repo A's ticket, goal or preset.
   */
  const launchSkill = (path: string, skill?: QuickAccessSkill) => launchSpawnDialog(path, skill);

  const launchCombo = (path: string, combo: QuickAccessCombo) => {
    void startSkillCombo(path, combo);
  };

  const overflowItem = (hidden: number): ContextMenuOption => ({
    label: `${hidden} more…`,
    icon: 'toc',
    action: () => setSettingsPath(contextMenu!.path),
  });

  const menuOptions: ContextMenuOption[] = contextMenu
    ? [
        ...(shownCombos.length > 0
          ? ([
              { type: 'header', label: 'Combos' },
              ...shownCombos.map((combo) => ({
                label: comboMenuLabel(combo),
                icon: 'account_tree',
                action: () => launchCombo(contextMenu.path, combo),
              })),
              ...(menuCombos.length > shownCombos.length
                ? [overflowItem(menuCombos.length - shownCombos.length)]
                : []),
              { type: 'separator' },
            ] as ContextMenuOption[])
          : []),
        ...(shownSkills.length > 0
          ? ([
              { type: 'header', label: 'Skills' },
              ...shownSkills.map((skill) => ({
                label: skill.label,
                icon: 'auto_awesome',
                action: () => launchSkill(contextMenu.path, skill),
              })),
              ...(menuSkills.length > shownSkills.length
                ? [overflowItem(menuSkills.length - shownSkills.length)]
                : []),
              { type: 'separator' },
            ] as ContextMenuOption[])
          : []),
        {
          label: 'Start Agent',
          icon: 'bolt',
          action: () => launchSkill(contextMenu.path),
        },
        {
          label: 'Copy Working Directory',
          icon: 'content_copy',
          action: () => {
            // Held before ContextMenu's onClose nulls the menu state.
            const path = contextMenu.path;
            // ContextMenu invokes actions synchronously, and an insecure
            // context has no navigator.clipboard at all — reaching for it
            // unguarded throws inside the click handler.
            if (!navigator.clipboard?.writeText) {
              showToast('Clipboard is unavailable in this context', 'error');
              return;
            }
            void navigator.clipboard
              .writeText(path)
              .then(() => showToast('Working directory copied', 'success'))
              .catch(() => showToast('Could not copy working directory', 'error'));
          },
        },
        { type: 'separator' },
        {
          label: 'Quick Access Settings',
          icon: 'settings',
          action: () => setSettingsPath(contextMenu.path),
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
    <div data-testid="quick-access" className="flex w-full flex-col items-center gap-3">
      {starredProjects.length === 0 && !canStarCurrent && (
        <p className="text-[11px] text-foreground-muted/70">Open a project, then star it.</p>
      )}
      <div
        data-testid="quick-access-row"
        data-columns={PROJECT_TILE_COLUMNS}
        className={`${PROJECT_TILE_GRID} items-start overflow-visible`}
      >
        {sortedProjects.map((project) => (
          <ProjectTile
            key={project.path}
            project={project}
            active={project.path === currentPath}
            wheelSuppressed={wheelPath !== null && wheelPath !== project.path}
            onSwitch={() => {
              if (project.path !== currentPath) onSwitchProject?.(project.path);
            }}
            onUnstar={() => removeStarredProject(project.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, path: project.path });
            }}
            onLaunchSkill={(skill) => launchSkill(project.path, skill)}
            onLaunchCombo={(combo) => launchCombo(project.path, combo)}
            onOpenSettings={() => setSettingsPath(project.path)}
            onWheelActivity={(active) => {
              setWheelPath((current) => {
                if (active) return project.path;
                return current === project.path ? null : current;
              });
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
      {settingsProject && (
        <QuickAccessSettingsDialog
          project={settingsProject}
          onClose={() => setSettingsPath(null)}
        />
      )}
    </div>
  );
}
