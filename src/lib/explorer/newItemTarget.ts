/** Minimal shape shared by the store's `FileNode` and the explorer's `FileTreeNode`. */
export interface TreeNodeLike {
  path: string;
  isDirectory: boolean;
  children?: TreeNodeLike[];
}

function findNode(nodes: TreeNodeLike[], path: string): TreeNodeLike | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const hit = findNode(node.children, path);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Where a "New File"/"New Folder" from the explorer toolbar should land:
 * the selected folder, the selected file's folder, or — with nothing usable
 * selected — the project root.
 *
 * A path the tree doesn't know (a file created moments ago, say) is treated as
 * a file, since only files can be selected in the explorer.
 */
export function newItemParentDir(
  rootPath: string,
  selectedPath: string | null | undefined,
  tree: TreeNodeLike[]
): string {
  const root = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
  if (!selectedPath || !selectedPath.startsWith(root + '/')) return root;

  const node = findNode(tree, selectedPath);
  if (node?.isDirectory) return selectedPath;

  const parent = selectedPath.slice(0, selectedPath.lastIndexOf('/'));
  return parent.length >= root.length ? parent : root;
}
