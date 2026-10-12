/**
 * The focused-hunk model of a review: the order in which the keyboard visits
 * the decisions in a change set, and where focus goes after each action, so
 * it always lands on the next thing to decide (`docs/design-merge-panel.md`,
 * "The keyboard story never breaks"). An open file contributes its hunks, a
 * folded or hunkless file its header.
 */

export interface FocusStop {
  path: string;
  /** `null` is the file's header. */
  hunk: number | null;
}

export interface FocusFile {
  path: string;
  patch: string;
  collapsed: boolean;
  viewed: boolean;
}

export function hunkCountOf(patch: string): number {
  let count = 0;
  for (const line of patch.split('\n')) if (line.startsWith('@@')) count++;
  return count;
}

export function focusStops(files: readonly FocusFile[]): FocusStop[] {
  return files.flatMap((file): FocusStop[] => {
    const hunks = file.collapsed ? 0 : hunkCountOf(file.patch);
    if (hunks === 0) return [{ path: file.path, hunk: null }];
    return Array.from({ length: hunks }, (_, hunk) => ({ path: file.path, hunk }));
  });
}

function header(path: string): FocusStop {
  return { path, hunk: null };
}

/** Where a review opens: the header of the first unviewed file, else the first file. */
export function firstStop(files: readonly FocusFile[]): FocusStop | null {
  const file = files.find((f) => !f.viewed) ?? files[0];
  return file ? header(file.path) : null;
}

function sameStop(a: FocusStop, b: FocusStop): boolean {
  return a.path === b.path && a.hunk === b.hunk;
}

/** ↓/↑: the neighbouring stop, staying put at either end. */
export function stepStop(
  stops: readonly FocusStop[],
  at: FocusStop | null,
  delta: 1 | -1
): FocusStop | null {
  if (stops.length === 0) return null;
  if (!at) return stops[0];
  const index = stops.findIndex((s) => sameStop(s, at));
  if (index === -1) {
    // A header that is not a stop (an open file with hunks) sits just before its first hunk.
    const first = stops.findIndex((s) => s.path === at.path);
    if (first === -1) return stops[0];
    return delta === 1 ? stops[first] : stops[Math.max(0, first - 1)];
  }
  return stops[Math.min(stops.length - 1, Math.max(0, index + delta))];
}

/** ]/[: the next or previous file's header; [ on a hunk goes to its own file's header first. */
export function nextFileStop(
  files: readonly Pick<FocusFile, 'path'>[],
  at: FocusStop | null,
  delta: 1 | -1
): FocusStop | null {
  if (files.length === 0) return null;
  const index = at ? files.findIndex((f) => f.path === at.path) : -1;
  if (index === -1) return header(files[0].path);
  if (delta === -1 && at?.hunk !== null) return header(files[index].path);
  return header(files[Math.min(files.length - 1, Math.max(0, index + delta))].path);
}

/**
 * The next decision after acting on a hunk. An accepted hunk stays on screen,
 * so focus moves past it; a discarded one disappears, so the hunk after it
 * moves up into its index.
 */
export function stopAfterAction(
  stops: readonly FocusStop[],
  at: FocusStop,
  action: 'accept' | 'discard'
): FocusStop | null {
  const index = stops.findIndex((s) => sameStop(s, at));
  const next = index === -1 ? undefined : stops[index + 1];
  if (!next) return null;
  if (action === 'discard' && next.path === at.path && next.hunk !== null) {
    return { path: at.path, hunk: next.hunk - 1 };
  }
  return next;
}

/** After V marks a file viewed (and folds it): the next unviewed file's header. */
export function stopAfterViewed(files: readonly FocusFile[], path: string): FocusStop | null {
  const index = files.findIndex((f) => f.path === path);
  const next = files.slice(index + 1).find((f) => !f.viewed);
  return next ? header(next.path) : null;
}
