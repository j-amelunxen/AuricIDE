import type { StateCreator } from 'zustand';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  expanded?: boolean;
  children?: FileNode[];
  gitStatus?: 'added' | 'modified' | 'deleted' | 'ignored';
  /** Filesystem birth time in unix milliseconds, when the OS reports one. */
  createdAt?: number;
  /** Newest descendant file birth time — lets a collapsed folder glow. */
  newestFileCreatedAt?: number;
  /** Filesystem modification time. Files only — never rolls up to a folder. */
  modifiedAt?: number;
}

export interface FileTreeSlice {
  fileTree: FileNode[];
  selectedPath: string | null;
  rootPath: string | null;
  setFileTree: (tree: FileNode[]) => void;
  setDirectoryChildren: (path: string, children: FileNode[]) => void;
  selectFile: (path: string) => void;
  toggleExpand: (path: string) => void;
  setRootPath: (path: string | null) => void;
  closeProject: () => void;
}

/** The node at `path`, or undefined when it is not in the loaded tree. */
export function findNodeByPath(nodes: FileNode[], path: string): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Every directory whose children are currently loaded. A watcher-driven refresh
 * re-reads only these: a directory nobody has opened has nothing on screen to
 * correct, and `toggleExpand` reads it fresh whenever it is opened.
 */
export function collectLoadedDirs(nodes: FileNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (!node.isDirectory || !node.children) continue;
    out.add(node.path);
    collectLoadedDirs(node.children, out);
  }
  return out;
}

/**
 * True when `path` lies below the folder `dir`. Either separator counts —
 * the explorer shows Windows paths as they come from the OS — and a folder
 * that already ends in one (`/`, `C:\\`) is not given a second.
 */
function isInside(path: string, dir: string): boolean {
  if (!path.startsWith(dir) || path.length === dir.length) return false;
  const last = dir[dir.length - 1];
  if (last === '/' || last === '\\') return true;
  const next = path[dir.length];
  return next === '/' || next === '\\';
}

/**
 * Rebuilds only the nodes on the way down to `path`; every other node is
 * handed back as the same object. The explorer's rows are memoized by node
 * identity, so cloning off-path folders would re-render the whole tree for a
 * change to one of them.
 */
function mapNodeAtPath(
  nodes: FileNode[],
  path: string,
  update: (node: FileNode) => FileNode
): FileNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.path === path) {
      changed = true;
      return update(node);
    }
    if (node.children && isInside(path, node.path)) {
      const children = mapNodeAtPath(node.children, path, update);
      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

export const createFileTreeSlice: StateCreator<FileTreeSlice> = (set) => ({
  fileTree: [],
  selectedPath: null,
  rootPath: null,
  setFileTree: (tree) => set({ fileTree: tree }),
  setDirectoryChildren: (path, children) =>
    set((state) => ({
      fileTree: mapNodeAtPath(state.fileTree, path, (node) => ({ ...node, children })),
    })),
  selectFile: (path) => set({ selectedPath: path }),
  toggleExpand: (path) =>
    set((state) => ({
      fileTree: mapNodeAtPath(state.fileTree, path, (node) => ({
        ...node,
        expanded: !node.expanded,
      })),
    })),
  setRootPath: (path) => set({ rootPath: path }),
  closeProject: () => set({ rootPath: null, fileTree: [], selectedPath: null }),
});
