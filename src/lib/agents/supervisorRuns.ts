import type { SupervisorRunFile } from '@/lib/tauri/supervisorRuns';

/** How many earlier runs the Supervisor tile's menu offers to resume. */
export const RECENT_RUNS_IN_MENU = 5;

const RUN_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:-(\d+))?$/;

const LABEL_FORMAT = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "Oct 16, 18:50" for the folder `2026-10-16_185017`. A second run in the
 * same second keeps its suffix ("… #2"); a folder someone renamed by hand
 * shows its name.
 */
export function supervisorRunLabel(name: string): string {
  const match = RUN_NAME.exec(name);
  if (!match) return name;
  const [, y, mo, d, h, mi, s, n] = match;
  const started = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  const label = LABEL_FORMAT.format(started);
  return n ? `${label} #${n}` : label;
}

export interface RunTreeFile {
  kind: 'file';
  name: string;
  path: string;
  modifiedAtMs: number | null;
}

export interface RunTreeFolder {
  kind: 'folder';
  name: string;
  /** Relative to the run, which keeps it unique as an expand key. */
  key: string;
  /** Newest modification of anything below it. */
  modifiedAtMs: number | null;
  children: RunTreeNode[];
}

export type RunTreeNode = RunTreeFile | RunTreeFolder;

function newer(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function sortNewestFirst(nodes: RunTreeNode[]): RunTreeNode[] {
  for (const node of nodes) {
    if (node.kind === 'folder') sortNewestFirst(node.children);
  }
  return nodes.sort(
    (a, b) =>
      (b.modifiedAtMs ?? -1) - (a.modifiedAtMs ?? -1) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}

/**
 * The flat file list Rust returns, as a tree. Folders and files mix and sort
 * by their newest change, so what the run touched last is on top at every
 * level — the question the browser exists to answer.
 */
export function buildRunTree(files: SupervisorRunFile[]): RunTreeNode[] {
  const root: RunTreeFolder = {
    kind: 'folder',
    name: '',
    key: '',
    modifiedAtMs: null,
    children: [],
  };
  for (const file of files) {
    const parts = file.relativePath.split('/');
    let folder = root;
    folder.modifiedAtMs = newer(folder.modifiedAtMs, file.modifiedAtMs);
    for (const part of parts.slice(0, -1)) {
      const key = folder.key ? `${folder.key}/${part}` : part;
      let next = folder.children.find(
        (child): child is RunTreeFolder => child.kind === 'folder' && child.name === part
      );
      if (!next) {
        next = { kind: 'folder', name: part, key, modifiedAtMs: null, children: [] };
        folder.children.push(next);
      }
      next.modifiedAtMs = newer(next.modifiedAtMs, file.modifiedAtMs);
      folder = next;
    }
    folder.children.push({
      kind: 'file',
      name: parts[parts.length - 1],
      path: file.path,
      modifiedAtMs: file.modifiedAtMs,
    });
  }
  return sortNewestFirst(root.children);
}
