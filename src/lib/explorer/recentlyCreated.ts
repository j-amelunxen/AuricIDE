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

export interface CreatedAtNode {
  createdAt?: number;
  isDirectory?: boolean;
  children?: CreatedAtNode[];
  /** Newest descendant file birth time, so a collapsed folder can still glow. */
  newestFileCreatedAt?: number;
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
