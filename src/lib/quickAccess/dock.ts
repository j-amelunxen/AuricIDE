import { moveId, type ListDropPlace } from '../pm/customOrder';
import type { StarredProject } from '../tauri/starredProjects';

/** Twin of `DOCK_MAX` in `src-tauri/src/recent_projects/types.rs`. */
export const DOCK_MAX = 8;

/** What a dragged tile carries: its project path. */
export const DOCK_DRAG_MIME = 'application/x-auric-quick-access';

/**
 * The dock is the fixed row under the grid. Its order is `dockIndex`, never the
 * sort the grid uses, so a tile stays where the user put it while the grid
 * re-sorts around it. A docked project is not repeated in the grid.
 */
export function splitDock<T extends Pick<StarredProject, 'dockIndex'>>(
  projects: readonly T[]
): { dock: T[]; rest: T[]; full: boolean } {
  const dock = projects
    .filter((project) => project.dockIndex !== undefined)
    .sort((a, b) => (a.dockIndex ?? 0) - (b.dockIndex ?? 0));
  const rest = projects.filter((project) => project.dockIndex === undefined);
  return { dock, rest, full: dock.length >= DOCK_MAX };
}

/**
 * The place (0-based) a dragged project takes when it is dropped before or after
 * `targetPath`. With no target it goes to the end. The backend uses the same
 * meaning: "insert at this place among the others".
 */
export function dockPlaceNextTo(
  dockPaths: readonly string[],
  draggedPath: string,
  targetPath: string | null,
  side: ListDropPlace
): number {
  const others = dockPaths.filter((path) => path !== draggedPath);
  if (targetPath === null || !others.includes(targetPath)) return others.length;
  const withDragged = [...others, draggedPath];
  return moveId(withDragged, draggedPath, targetPath, side).indexOf(draggedPath);
}

/**
 * Optimistic twin of `apply_dock_place` in the Rust store: docks `path` at
 * `place` (clamped), moves it there, or takes it out on `null`, then renumbers
 * the dock 0..n-1. Returns the same array when nothing changes (unknown path,
 * or a newcomer refused by a full dock).
 */
export function applyDockPlace<T extends Pick<StarredProject, 'path' | 'dockIndex'>>(
  projects: readonly T[],
  path: string,
  place: number | null
): T[] {
  const target = projects.find((project) => project.path === path);
  if (!target) return projects as T[];
  const { dock } = splitDock(projects);
  const wasDocked = target.dockIndex !== undefined;
  if (place !== null && !wasDocked && dock.length >= DOCK_MAX) return projects as T[];
  const order = dock.map((project) => project.path).filter((p) => p !== path);
  if (place !== null) order.splice(Math.min(Math.max(place, 0), order.length), 0, path);
  const indexOf = new Map(order.map((p, index) => [p, index]));
  return projects.map((project) => {
    const index = indexOf.get(project.path);
    if (index === project.dockIndex) return project;
    const { dockIndex: _drop, ...rest } = project;
    return (index === undefined ? rest : { ...rest, dockIndex: index }) as T;
  });
}
