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

function updateNodeInTree(nodes: FileNode[], path: string, update: Partial<FileNode>): FileNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, ...update };
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, path, update) };
    }
    return node;
  });
}

function toggleExpandInTree(nodes: FileNode[], path: string): FileNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, expanded: !node.expanded };
    }
    if (node.children) {
      return { ...node, children: toggleExpandInTree(node.children, path) };
    }
    return node;
  });
}

export const createFileTreeSlice: StateCreator<FileTreeSlice> = (set) => ({
  fileTree: [],
  selectedPath: null,
  rootPath: null,
  setFileTree: (tree) => set({ fileTree: tree }),
  setDirectoryChildren: (path, children) =>
    set((state) => ({ fileTree: updateNodeInTree(state.fileTree, path, { children }) })),
  selectFile: (path) => set({ selectedPath: path }),
  toggleExpand: (path) => set((state) => ({ fileTree: toggleExpandInTree(state.fileTree, path) })),
  setRootPath: (path) => set({ rootPath: path }),
  closeProject: () => set({ rootPath: null, fileTree: [], selectedPath: null }),
});
