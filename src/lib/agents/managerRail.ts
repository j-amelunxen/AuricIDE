import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { RunTreeNode } from './supervisorRuns';

/** The file a manager is steered by, at the top of its folder. */
export const MANAGER_INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';
/** The memory bundle's folder key in a run tree (keys are relative to the run). */
export const MANAGER_KNOWLEDGE_FOLDER = 'knowledge';

const parsed = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * When a manager was last at work, from what the registry and the runs list
 * already know: its last launch, its last session's start and note, and the
 * newest change in its folder (which the manager's own memory writes move).
 */
export function managerActivityMs(
  manager: Pick<SupervisorManager, 'lastLaunch' | 'session'>,
  runModifiedAtMs: number | null
): number | null {
  const times = [
    parsed(manager.lastLaunch?.at),
    parsed(manager.session?.startedAt),
    parsed(manager.session?.notedAt),
    runModifiedAtMs,
  ].filter((ms): ms is number => ms !== null);
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * What the runs rail remembers for the app session. The sidebar remounts the
 * panel on every rail switch, so component state alone would unfold the
 * default manager again and forget what the human folded. Plain module state,
 * read on mount and written on change: nothing renders from it.
 */
export const runsRailMemory: { defaultUnfolded: boolean; expanded: ReadonlySet<string> } = {
  defaultUnfolded: false,
  expanded: new Set(),
};

export function resetRunsRailMemoryForTests(): void {
  runsRailMemory.defaultUnfolded = false;
  runsRailMemory.expanded = new Set();
}

export interface ManagerRecency {
  key: string;
  name: string;
  /** A supervisor is live in the manager's folder. */
  running: boolean;
  activityMs: number | null;
}

const byNameThenKey = (a: ManagerRecency, b: ManagerRecency) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.key.localeCompare(b.key);

/**
 * The manager the runs rail unfolds when it first shows: a running one before
 * any other, then the one at work most recently. A tie goes to the name the
 * rail lists first, so the same data always unfolds the same row.
 */
export function mostRecentManagerKey(managers: readonly ManagerRecency[]): string | null {
  const ranked = [...managers].sort(
    (a, b) =>
      Number(b.running) - Number(a.running) ||
      (b.activityMs ?? -Infinity) - (a.activityMs ?? -Infinity) ||
      byNameThenKey(a, b)
  );
  return ranked[0]?.key ?? null;
}

const isInstructions = (node: RunTreeNode) =>
  node.kind === 'file' && node.name === MANAGER_INSTRUCTIONS_FILE;
const isKnowledge = (node: RunTreeNode) =>
  node.kind === 'folder' && node.name === MANAGER_KNOWLEDGE_FOLDER;

/** Files, then subfolders, at this level and every one below; each group keeps its order. */
function filesFirst(nodes: readonly RunTreeNode[]): RunTreeNode[] {
  const nested = nodes.map((node) =>
    node.kind === 'folder' ? { ...node, children: filesFirst(node.children) } : node
  );
  return [
    ...nested.filter((node) => node.kind === 'file'),
    ...nested.filter((node) => node.kind === 'folder'),
  ];
}

/**
 * A manager's folder as the rail shows it: what steers it and what it
 * remembers on top, then files before subfolders at every level, as a file
 * browser lists them. Within each group the run tree's own order (newest
 * first) stands. The plain run tree keeps mixing them: there the newest
 * change on top is the point.
 */
export function managerFolderFirst(tree: readonly RunTreeNode[]): RunTreeNode[] {
  const ordered = filesFirst(tree);
  return [
    ...ordered.filter(isInstructions),
    ...ordered.filter(isKnowledge),
    ...ordered.filter((node) => !isInstructions(node) && !isKnowledge(node)),
  ];
}
