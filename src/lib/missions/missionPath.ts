/**
 * Where a root goal's mission folder lives: a path relative to the project root
 * (`missions/<slug>`), so the link survives a moved checkout or a worktree.
 * One rule for every writer (MCP `create_goal`/`update_goal`) and every reader
 * (the goal detail panel), so a stored value can never point outside the project.
 */

/**
 * Tidies a mission path into its stored form, or `null` for "no mission".
 * Throws when the value is absolute or climbs out of the project.
 */
export function normalizeMissionPath(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return null;
  if (trimmed.startsWith('/') || trimmed.startsWith('~') || /^[A-Za-z]:/.test(trimmed)) {
    throw new Error(
      `Mission path '${trimmed}' must be relative to the project (e.g. missions/<slug>)`
    );
  }
  const segments = trimmed.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) {
    throw new Error(`Mission path '${trimmed}' must stay inside the project`);
  }
  if (segments.length === 0) {
    throw new Error(`Mission path '${trimmed}' must name a folder inside the project`);
  }
  return segments.join('/');
}

/**
 * The absolute mission folder for a stored path, or `null` when there is
 * nothing to resolve. A stored value that breaks the rule (written by hand into
 * the database) resolves to `null` rather than to a folder outside the project.
 */
export function resolveMissionDir(
  rootPath: string | null | undefined,
  missionPath: string | null | undefined
): string | null {
  if (!rootPath) return null;
  let relative: string | null;
  try {
    relative = normalizeMissionPath(missionPath);
  } catch {
    return null;
  }
  if (relative === null) return null;
  return `${rootPath.replace(/\/+$/, '')}/${relative}`;
}
