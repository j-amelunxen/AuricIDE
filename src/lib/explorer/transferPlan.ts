import { isSameOrInside, topLevelPaths } from './treeSelection';

/**
 * What a drop onto a folder does with each dropped item, before anything is
 * touched on disk. Explorer rows are moved; files dragged in from Finder are
 * copied, so the original stays where the user took it from.
 */
export type TransferKind = 'move' | 'copy';

export interface PlannedTransfer {
  source: string;
  destination: string;
}

export type SkipReason = 'into-itself' | 'same-folder';

export interface SkippedTransfer {
  source: string;
  reason: SkipReason;
}

export interface TransferPlan {
  transfers: PlannedTransfer[];
  skipped: SkippedTransfer[];
}

export function baseName(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * One entry per dropped item that should land in `destDir`. An item already
 * in that folder stays put, and a folder never goes into itself or its own
 * subtree — for a copy that would recurse without end, for a move the OS
 * refuses it. Items that travel with a dropped ancestor folder are not listed
 * twice.
 */
export function planTransfers(sources: readonly string[], destDir: string): TransferPlan {
  const plan: TransferPlan = { transfers: [], skipped: [] };
  for (const source of topLevelPaths(sources.filter((s) => s.length > 0))) {
    if (isSameOrInside(destDir, source)) {
      plan.skipped.push({ source, reason: 'into-itself' });
    } else if (parentOf(source) === destDir) {
      plan.skipped.push({ source, reason: 'same-folder' });
    } else {
      plan.transfers.push({ source, destination: joinPath(destDir, baseName(source)) });
    }
  }
  return plan;
}

/** True when the drop would change nothing or is refused for every item. */
export function isNoopDrop(sources: readonly string[], destDir: string): boolean {
  return planTransfers(sources, destDir).transfers.length === 0;
}

/**
 * The name Finder gives the n-th "keep both" copy: `notes 2.md`, `notes 3.md`,
 * `docs 2`. A leading dot is part of the name, not an extension (`.env 2`).
 */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} ${n}`;
  return `${name.slice(0, dot)} ${n}${name.slice(dot)}`;
}

/**
 * Why the item already at `destination` may not be replaced, or null when it
 * may. Replacing deletes what is there first, so a destination that holds any
 * item of the drop (moving `a/x/x` into `a`, or `a/x/y.md` dropped together
 * with another `x`) would delete that item too.
 *
 * Compared without case: macOS volumes are case-insensitive by default, so
 * `a/x` and `a/X` are the same folder there and deleting one deletes both.
 * On a case-sensitive volume this only refuses a little more than needed.
 */
export function replaceBlocker(sources: readonly string[], destination: string): string | null {
  const dest = destination.toLowerCase();
  if (sources.some((source) => isSameOrInside(source.toLowerCase(), dest))) {
    return `"${baseName(destination)}" contains an item being moved, so it cannot be replaced`;
  }
  return null;
}
