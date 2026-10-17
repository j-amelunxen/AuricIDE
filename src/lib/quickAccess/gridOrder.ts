import { moveId, type ListDropPlace } from '../pm/customOrder';

/**
 * The hand-made order of the Quick Access grid: a list of project paths, kept as
 * an app pref. It is a view setting, not a field of the project record, so no
 * Rust twin is needed. Paths it does not know sort after it; paths that are
 * gone are ignored when it is read back.
 */
export function moveGridTile(
  visiblePaths: readonly string[],
  dragged: string,
  target: string,
  side: ListDropPlace
): string[] {
  // A tile that comes out of the dock is not in the grid yet.
  const base = visiblePaths.includes(dragged) ? [...visiblePaths] : [...visiblePaths, dragged];
  return moveId(base, dragged, target, side);
}

export function serializeGridOrder(paths: readonly string[]): string {
  return JSON.stringify(paths);
}

export function parseGridOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const paths = parsed.filter((entry): entry is string => typeof entry === 'string');
    return [...new Set(paths)];
  } catch {
    return [];
  }
}
