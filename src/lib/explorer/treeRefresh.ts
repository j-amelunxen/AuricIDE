import type { FileNode } from '@/lib/store/fileTreeSlice';
import type { FileEntry } from '@/lib/tauri/fs';

type Badge = FileNode['gitStatus'];
type ResolveBadge = (path: string) => Badge;

function sameNode(prev: FileNode, entry: FileEntry, gitStatus: Badge): boolean {
  return (
    prev.name === entry.name &&
    prev.isDirectory === entry.isDirectory &&
    prev.gitStatus === gitStatus &&
    prev.createdAt === entry.createdAt &&
    prev.newestFileCreatedAt === entry.newestFileCreatedAt &&
    prev.modifiedAt === entry.modifiedAt
  );
}

/**
 * Turns a directory listing into tree nodes, keeping the existing node object
 * wherever nothing about it changed. A refresh that finds the folder as it was
 * returns the old array and `changed: false`, so the tree is not re-rendered
 * for a listing that says nothing new.
 */
export function buildNodes(
  entries: readonly FileEntry[],
  existing: readonly FileNode[],
  resolve: ResolveBadge
): { nodes: FileNode[]; changed: boolean } {
  const byPath = new Map(existing.map((n) => [n.path, n]));
  let changed = entries.length !== existing.length;
  const nodes = entries.map((e, i) => {
    const prev = byPath.get(e.path);
    const gitStatus = resolve(e.path);
    if (prev && sameNode(prev, e, gitStatus)) {
      if (existing[i] !== prev) changed = true;
      return prev;
    }
    changed = true;
    return {
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      expanded: prev?.expanded ?? false,
      children: prev?.children ?? (e.isDirectory ? [] : undefined),
      gitStatus,
      createdAt: e.createdAt,
      newestFileCreatedAt: e.newestFileCreatedAt,
      modifiedAt: e.modifiedAt,
    };
  });
  return changed ? { nodes, changed } : { nodes: existing as FileNode[], changed };
}

/**
 * Re-resolves the git badge of every loaded node. Needed when ignore rules
 * change: a `.gitignore` edit can flip badges in folders nobody refreshed.
 * Untouched branches keep their references.
 */
export function restampGitStatus(nodes: FileNode[], resolve: ResolveBadge): FileNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    const gitStatus = resolve(node.path);
    const children =
      node.children && node.children.length > 0
        ? restampGitStatus(node.children, resolve)
        : node.children;
    if (gitStatus === node.gitStatus && children === node.children) return node;
    changed = true;
    return { ...node, gitStatus, children };
  });
  return changed ? next : nodes;
}

/** True when a listing holds exactly the paths the tree already shows. */
export function sameEntryPaths(entries: readonly FileEntry[], nodes: readonly FileNode[]): boolean {
  if (entries.length !== nodes.length) return false;
  const known = new Set(nodes.map((n) => n.path));
  return entries.every((e) => known.has(e.path));
}
