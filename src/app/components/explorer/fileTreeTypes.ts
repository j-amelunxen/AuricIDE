export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  expanded?: boolean;
  children?: FileTreeNode[];
  gitStatus?: 'added' | 'modified' | 'deleted' | 'ignored';
  /** Filesystem birth time in unix milliseconds, when the OS reports one. */
  createdAt?: number;
  /** Newest descendant file birth time — lets a collapsed folder glow. */
  newestFileCreatedAt?: number;
  /**
   * Filesystem modification time in unix milliseconds. Files only — unlike
   * `createdAt` this never rolls up to a folder, so a modified glow is a
   * file-row signal alone.
   */
  modifiedAt?: number;
}

/**
 * Explorer-internal drag payload for moving a node into a folder. Kept separate
 * from the `text/plain` payload (which markdown files also set, so they can be
 * dropped into the editor to embed) so the two drag purposes never collide.
 */
export const MOVE_MIME = 'application/x-auric-move';

export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

/** A move is a no-op or illegal if it lands on itself, its own folder, or its subtree. */
export function isInvalidMove(source: string, destDir: string): boolean {
  if (!source) return true;
  if (source === destDir) return true;
  if (parentDir(source) === destDir) return true;
  if (destDir === source || destDir.startsWith(source + '/')) return true;
  return false;
}

export interface FlatTreeEntry {
  path: string;
  isDirectory: boolean;
}

/**
 * Depth-first list of every currently *visible* row (children of collapsed
 * directories excluded) in on-screen order. Shift-range selection and
 * arrow-key navigation both walk this — it's what "next row" actually means.
 */
export function flattenVisibleTree(nodes: FileTreeNode[]): FlatTreeEntry[] {
  const out: FlatTreeEntry[] = [];
  for (const node of nodes) {
    out.push({ path: node.path, isDirectory: node.isDirectory });
    if (node.isDirectory && node.expanded && node.children?.length) {
      out.push(...flattenVisibleTree(node.children));
    }
  }
  return out;
}

export function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

export function computeRange(
  flat: FlatTreeEntry[],
  anchor: string | null,
  target: string
): string[] {
  const paths = flat.map((f) => f.path);
  const anchorIndex = anchor ? paths.indexOf(anchor) : -1;
  const targetIndex = paths.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) return [target];
  const [start, end] =
    anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return paths.slice(start, end + 1);
}

export function focusRow(path: string): void {
  document.querySelector<HTMLElement>(`[data-testid="tree-item-${path}"]`)?.focus();
}
