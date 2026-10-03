'use client';

import { useState } from 'react';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import {
  parseQuickAccessSort,
  sortQuickAccessProjects,
  type QuickAccessSort,
} from '@/lib/quickAccess/badge';
import { useStore } from '@/lib/store';
import {
  quickAccessCombos,
  quickAccessSkills,
  type QuickAccessCombo,
  type QuickAccessSkill,
} from '@/lib/store/starredProjectsSlice';
import { comboMenuLabel } from '@/lib/quickAccess/combo';
import { DOCK_DRAG_MIME, dockPlaceNextTo, splitDock } from '@/lib/quickAccess/dock';
import type { StarredProject } from '@/lib/tauri/starredProjects';
import { menuSkillEntries } from '@/lib/quickAccess/menuSkills';
import { loadAuricSkills } from '@/lib/settings/auricSkills';
import { useSpawnLauncher } from '@/lib/quickAccess/useSpawnLauncher';
import { PROJECT_TILE_COLUMNS, PROJECT_TILE_GRID } from './projectGrid';
import { ProjectBadgeField } from './ProjectBadgeField';
import { ProjectDescriptionDialog } from './ProjectDescriptionDialog';
import { QuickAccessSettingsDialog } from './QuickAccessSettingsDialog';
import { ProjectTile, type ProjectTileProps } from './ProjectTile';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useProjectDirty } from '@/lib/hooks/useProjectDirty';
import { copyToClipboard } from '@/lib/tauri/clipboard';

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
 * slot. Tiles sort by name unless the user switches to badge. Name order is
 * the default on purpose: a lane mark must not slide a tile out from under a
 * remembered position. Badge order groups the marks and leaves unmarked
 * tiles after them. Unstarring requires a deliberate hold (not a single tap)
 * so a stray click can't drop a tile.
 */
export function QuickAccess({ currentPath, onSwitchProject }: QuickAccessProps) {
  const starredProjects = useStore((s) => s.starredProjects);
  const removeStarredProject = useStore((s) => s.removeStarredProject);
  const addStarredProject = useStore((s) => s.addStarredProject);
  const setStarredProjectDock = useStore((s) => s.setStarredProjectDock);
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
  const [descriptionPath, setDescriptionPath] = useState<string | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [sort, setSort] = useState<QuickAccessSort>(() =>
    parseQuickAccessSort(readAppPref(APP_CONFIG_KEYS.quickAccessSort))
  );

  const chooseSort = (next: QuickAccessSort) => {
    setSort(next);
    writeAppPref(APP_CONFIG_KEYS.quickAccessSort, next);
  };

  // Resolved from the store rather than captured, so the dialog keeps editing
  // the live record if it changes underneath.
  const settingsProject = settingsPath
    ? starredProjects.find((p) => p.path === settingsPath)
    : undefined;

  const descriptionProject = descriptionPath
    ? starredProjects.find((p) => p.path === descriptionPath)
    : undefined;

  const menuProject = contextMenu
    ? starredProjects.find((p) => p.path === contextMenu.path)
    : undefined;
  const menuSkills = menuProject
    ? menuSkillEntries(quickAccessSkills(menuProject), loadAuricSkills())
    : [];
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

  const contextMenuDockOption = (): ContextMenuOption => {
    const docked =
      starredProjects.find((p) => p.path === contextMenu?.path)?.dockIndex !== undefined;
    return docked
      ? {
          label: 'Remove from Dock',
          icon: 'close',
          action: () => setStarredProjectDock(contextMenu!.path, null),
        }
      : {
          label: 'Move to Dock',
          icon: 'push_pin',
          action: () =>
            setStarredProjectDock(
              contextMenu!.path,
              dockPlaceNextTo(dockPaths, contextMenu!.path, null, 'after')
            ),
        };
  };

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
            void copyToClipboard(path).then((ok) => {
              if (ok) {
                showToast('Working directory copied', 'success');
              } else {
                showToast('Could not copy working directory', 'error');
              }
            });
          },
        },
        {
          label: 'Set description…',
          icon: 'edit_note',
          action: () => setDescriptionPath(contextMenu.path),
        },
        contextMenuDockOption(),
        {
          label: sort === 'badge' ? 'Sort projects by name' : 'Sort projects by badge',
          icon: 'filter_list',
          action: () => chooseSort(sort === 'badge' ? 'name' : 'badge'),
        },
        { type: 'separator' },
        {
          label: 'Quick Access Settings',
          icon: 'settings',
          action: () => setSettingsPath(contextMenu.path),
        },
      ]
    : [];

  const { dock, rest } = splitDock(starredProjects);
  const sortedProjects = sortQuickAccessProjects(rest, sort);
  const dirtyByProject = useProjectDirty(
    [...sortedProjects, ...dock].map((project) => project.path)
  );
  const dockPaths = dock.map((project) => project.path);

  const dragPathOf = (event: React.DragEvent): string | null => {
    const path = event.dataTransfer.getData(DOCK_DRAG_MIME);
    return path || dragPath;
  };

  const tileProps = (project: StarredProject, inDock: boolean): ProjectTileProps['drag'] => ({
    onDragStart: (event) => {
      event.dataTransfer.setData(DOCK_DRAG_MIME, project.path);
      event.dataTransfer.effectAllowed = 'move';
      setDragPath(project.path);
    },
    onDragEnd: () => setDragPath(null),
    ...(inDock
      ? {
          onDragOver: (event: React.DragEvent) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          },
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const dragged = dragPathOf(event);
            setDragPath(null);
            if (!dragged || dragged === project.path) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
            setStarredProjectDock(dragged, dockPlaceNextTo(dockPaths, dragged, project.path, side));
          },
        }
      : {}),
  });

  const renderTile = (project: StarredProject, inDock: boolean) => (
    <ProjectTile
      key={project.path}
      project={project}
      active={project.path === currentPath}
      dirty={dirtyByProject[project.path] === true}
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
      drag={tileProps(project, inDock)}
    />
  );

  // Grid and dock accept a drop on their empty parts too: the dock appends,
  // the grid takes a docked tile back out.
  const dragging = dragPath !== null;
  const draggingDocked = dragging && dockPaths.includes(dragPath);
  const dockDropZone = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const dragged = dragPathOf(event);
      setDragPath(null);
      if (dragged)
        setStarredProjectDock(dragged, dockPlaceNextTo(dockPaths, dragged, null, 'after'));
    },
  };
  const gridDropZone = {
    onDragOver: (event: React.DragEvent) => {
      if (!draggingDocked) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: React.DragEvent) => {
      const dragged = dragPathOf(event);
      if (!dragged || !dockPaths.includes(dragged)) return;
      event.preventDefault();
      setDragPath(null);
      setStarredProjectDock(dragged, null);
    },
  };

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
        data-sort={sort}
        className={`${PROJECT_TILE_GRID} items-start overflow-visible`}
        {...gridDropZone}
      >
        {starredProjects.length > 1 && (
          <div
            role="group"
            aria-label="Sort projects"
            data-testid="quick-access-sort"
            className="flex w-full basis-full items-center justify-end gap-0.5"
          >
            <span className="mr-1 text-[9px] font-bold uppercase tracking-[0.16em] text-foreground-muted/50">
              Sort
            </span>
            {(
              [
                ['name', 'Name'],
                ['badge', 'Badge'],
              ] as const
            ).map(([option, label]) => {
              const selected = option === sort;
              return (
                <button
                  key={option}
                  type="button"
                  data-testid={`quick-access-sort-${option}`}
                  aria-pressed={selected}
                  onClick={() => chooseSort(option)}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-[color,background-color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light ${
                    selected
                      ? 'bg-primary/15 text-primary-light'
                      : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {sortedProjects.map((project) => renderTile(project, false))}
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
      {(dock.length > 0 || dragging) && (
        <div
          role="group"
          aria-label="Dock"
          data-testid="quick-access-dock"
          data-drop-active={dragging}
          className={`flex min-h-[4.5rem] w-full max-w-fit flex-wrap items-start justify-center gap-x-1 gap-y-2 rounded-2xl border px-3 py-2.5 transition-[border-color,background-color] duration-150 ${
            dragging ? 'border-primary/40 bg-primary/5' : 'border-white/10 bg-white/[0.03]'
          }`}
          {...dockDropZone}
        >
          {dock.length === 0 ? (
            <p className="self-center px-4 text-[11px] text-foreground-muted/70">
              Drop projects here to keep them in place.
            </p>
          ) : (
            dock.map((project) => renderTile(project, true))
          )}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          width={220}
          options={menuOptions}
          onClose={() => setContextMenu(null)}
          preface={
            menuProject ? (
              <ProjectBadgeField project={menuProject} onDone={() => setContextMenu(null)} />
            ) : undefined
          }
        />
      )}
      {descriptionProject && (
        <ProjectDescriptionDialog
          project={descriptionProject}
          onClose={() => setDescriptionPath(null)}
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
