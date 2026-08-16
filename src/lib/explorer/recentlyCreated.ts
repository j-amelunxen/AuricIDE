export const RECENTLY_CREATED_WINDOW_MS = 5 * 60 * 1000;

/** True when `createdAtMs` falls inside the recent-creation window ending at `nowMs`. */
export function isRecentlyCreated(
  createdAtMs: number | undefined,
  nowMs: number,
  windowMs = RECENTLY_CREATED_WINDOW_MS
): boolean {
  if (createdAtMs === undefined) return false;
  const age = nowMs - createdAtMs;
  return age >= 0 && age < windowMs;
}

/**
 * True when `modifiedAtMs` falls inside the recent-modification window ending
 * at `nowMs`. Same window and logic as `isRecentlyCreated` — a distinct name
 * so call sites read as what they mean, not as a reused Created check.
 */
export function isRecentlyModified(
  modifiedAtMs: number | undefined,
  nowMs: number,
  windowMs = RECENTLY_CREATED_WINDOW_MS
): boolean {
  return isRecentlyCreated(modifiedAtMs, nowMs, windowMs);
}

export interface CreatedAtNode {
  createdAt?: number;
  isDirectory?: boolean;
  children?: CreatedAtNode[];
  /** Newest descendant file birth time, so a collapsed folder can still glow. */
  newestFileCreatedAt?: number;
  /** Filesystem modification time. Files only — folders never carry a modified glow. */
  modifiedAt?: number;
}

/**
 * A file is recent on its own birth time. A folder is recent only when a
 * descendant *file* is — an empty new folder does not light up.
 */
export function hasRecentlyCreatedFile(
  node: CreatedAtNode,
  nowMs: number,
  windowMs = RECENTLY_CREATED_WINDOW_MS
): boolean {
  if (!node.isDirectory) {
    return isRecentlyCreated(node.createdAt, nowMs, windowMs);
  }
  if (isRecentlyCreated(node.newestFileCreatedAt, nowMs, windowMs)) {
    return true;
  }
  return node.children?.some((child) => hasRecentlyCreatedFile(child, nowMs, windowMs)) ?? false;
}

/** Every birth time that can keep a glow alive, collapsed folders included. */
export function collectCreatedAt(nodes: CreatedAtNode[]): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  for (const node of nodes) {
    out.push(node.createdAt);
    out.push(node.newestFileCreatedAt);
    if (node.children?.length) {
      out.push(...collectCreatedAt(node.children));
    }
  }
  return out;
}

/**
 * Every modification time that can keep a modified-glow alive. Folders are
 * skipped — unlike creation, a modified glow never rolls up to an ancestor —
 * but their children are still walked so nested files are found.
 */
export function collectModifiedAt(nodes: CreatedAtNode[]): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  for (const node of nodes) {
    if (!node.isDirectory) {
      out.push(node.modifiedAt);
    }
    if (node.children?.length) {
      out.push(...collectModifiedAt(node.children));
    }
  }
  return out;
}

/** Soonest moment a currently-recent timestamp leaves the window, or null. */
export function nextRecentlyCreatedExpiry(
  createdAtTimes: Array<number | undefined>,
  nowMs: number,
  windowMs = RECENTLY_CREATED_WINDOW_MS
): number | null {
  let soonest: number | null = null;
  for (const createdAt of createdAtTimes) {
    if (createdAt === undefined) continue;
    const expiry = createdAt + windowMs;
    if (expiry > nowMs && (soonest === null || expiry < soonest)) {
      soonest = expiry;
    }
  }
  return soonest;
}
