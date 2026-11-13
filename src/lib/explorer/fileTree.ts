export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  expanded?: boolean;
  children?: FileTreeNode[];
  gitStatus?: 'added' | 'modified' | 'deleted' | 'ignored' | 'conflicted';
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

export function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
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

export interface VisibleRow {
  node: FileTreeNode;
  depth: number;
}

/** The visible rows in on-screen order with their nesting depth — what the explorer renders. */
export function flattenVisibleNodes(nodes: FileTreeNode[], depth = 0): VisibleRow[] {
  const out: VisibleRow[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.isDirectory && node.expanded && node.children?.length) {
      out.push(...flattenVisibleNodes(node.children, depth + 1));
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
