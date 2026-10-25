/**
 * Multi-selection in the explorer, as Finder and VS Code do it: a plain click
 * selects one row, Cmd/Ctrl+click toggles a row, Shift+click selects the range
 * from the anchor, Cmd/Ctrl+Shift+click adds that range to what is selected.
 *
 * `paths` keeps the order in which rows joined the selection: "Compare
 * Selected" reads the first two as left and right.
 */
export interface TreeSelection {
  paths: string[];
  /** The row the selection is centred on (the accent border, the focus target). */
  primary: string | null;
  /** Where the next Shift+click range starts. */
  anchor: string | null;
}

/** What is selected right now: the explicit list, else the single primary row. */
export function effectiveSelection(paths: readonly string[], primary: string | null): string[] {
  if (paths.length > 0) return [...paths];
  return primary ? [primary] : [];
}

/** Cmd/Ctrl+click: add the row, or take it out when it is already selected. */
export function toggleSelection(
  paths: readonly string[],
  primary: string | null,
  path: string
): TreeSelection {
  const current = effectiveSelection(paths, primary);
  if (!current.includes(path)) {
    return { paths: [...current, path], primary: path, anchor: path };
  }
  // The last selected row stays: an empty list would let the store's primary
  // row reappear in the next toggle, and there is always a focused row anyway.
  if (current.length === 1) return { paths: current, primary: path, anchor: path };
  const rest = current.filter((p) => p !== path);
  // The primary row must stay part of the selection, or the accent border and
  // the keyboard would sit on a row that is not selected.
  const nextPrimary =
    primary !== null && primary !== path && rest.includes(primary) ? primary : null;
  return { paths: rest, primary: nextPrimary ?? rest[rest.length - 1] ?? null, anchor: path };
}

/**
 * The visible rows from `anchor` to `target`, both included, in on-screen
 * order. Without a visible anchor the range is the target alone.
 */
export function rangeBetween(
  visible: readonly string[],
  anchor: string | null,
  target: string
): string[] {
  const from = anchor === null ? -1 : visible.indexOf(anchor);
  const to = visible.indexOf(target);
  if (from === -1 || to === -1) return [target];
  return from <= to ? visible.slice(from, to + 1) : visible.slice(to, from + 1);
}

/**
 * Shift+click selects the range and keeps the anchor where it was, so a second
 * Shift+click re-draws the range from the same row. With `additive`
 * (Cmd/Ctrl+Shift) the range joins the rows already selected.
 */
export function rangeSelection(options: {
  visible: readonly string[];
  paths: readonly string[];
  primary: string | null;
  anchor: string | null;
  target: string;
  additive: boolean;
}): TreeSelection {
  const { visible, paths, primary, target, additive } = options;
  const anchor = options.anchor ?? primary;
  const range = rangeBetween(visible, anchor, target);
  const base = additive ? effectiveSelection(paths, primary) : [];
  const merged = [...base, ...range.filter((p) => !base.includes(p))];
  return { paths: merged, primary: target, anchor: anchor ?? target };
}

/** True when `path` is `ancestor` itself or lies anywhere beneath it. */
export function isSameOrInside(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + '/');
}

/**
 * Drops every path that already travels with a selected ancestor folder:
 * moving or deleting `src` and `src/a.ts` together means moving `src`.
 */
export function topLevelPaths(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter((p) => !unique.some((other) => other !== p && isSameOrInside(p, other)));
}

/**
 * What a drag picks up: the whole selection when the grabbed row is part of
 * it, otherwise only the grabbed row (Finder and VS Code do the same).
 */
export function dragItems(
  paths: readonly string[],
  primary: string | null,
  grabbed: string
): string[] {
  const current = effectiveSelection(paths, primary);
  return current.includes(grabbed) ? topLevelPaths(current) : [grabbed];
}

/** Re-points selected paths after `from` moved to `to` (a folder carries its subtree). */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return path;
}
