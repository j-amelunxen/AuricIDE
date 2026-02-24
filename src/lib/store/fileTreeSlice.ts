import type { StateCreator } from 'zustand';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  expanded?: boolean;
  children?: FileNode[];
  gitStatus?: 'added' | 'modified' | 'deleted' | 'ignored';
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
