import { isNoopDrop, parentOf } from '@/lib/explorer/transferPlan';

/** Row attributes the drop hit-test reads; set by `TreeNode`. */
const ROW_PATH_ATTR = 'data-tree-path';
const ROW_DIR_ATTR = 'data-tree-dir';

export interface DropTarget {
  /** The folder the items would land in. */
  dir: string;
  /** The folder row that was hovered, when the pointer is on one (auto-expand). */
  hoveredDir: string | null;
}

/**
 * The folder a drop at `element` lands in: a folder row is that folder, a file
 * row is the folder it lives in, and empty space in the pane is the project
 * root. Anything outside the pane is no target at all.
 */
export function dropTargetAt(
  element: Element | null,
  pane: HTMLElement | null,
  rootPath: string | null | undefined
): DropTarget | null {
  if (!element || !pane || !pane.contains(element)) return null;
  const row = element.closest(`[${ROW_PATH_ATTR}]`);
  const path = row?.getAttribute(ROW_PATH_ATTR) ?? null;
  if (row && path !== null && pane.contains(row)) {
    if (row.getAttribute(ROW_DIR_ATTR) === 'true') return { dir: path, hoveredDir: path };
    return { dir: parentOf(path), hoveredDir: null };
  }
  return rootPath ? { dir: rootPath, hoveredDir: null } : null;
}

/** The element under a viewport point; null where the DOM cannot tell (jsdom). */
export function elementAt(x: number, y: number): Element | null {
  return typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
}

/** True when at least one dragged item would actually go somewhere. */
export function canDropInto(items: readonly string[], dir: string): boolean {
  return !isNoopDrop(items, dir);
}
