/**
 * Which working directories a spawn dialog will launch into when Quick Access
 * projects can be multi-selected.
 *
 * Selected pins win over the typed path: the chips are a deliberate set, and
 * a leftover character in the text field must not add a surprise N+1st agent.
 * With nothing selected the typed path is the only target — including empty,
 * which is how a launch with no working directory has always worked.
 *
 * Order follows Quick Access (alphabetical by name), not click order, so
 * Select All and a hand-picked subset come out the same way the tiles read.
 */

const NAME_COLLATOR: Intl.CollatorOptions = { sensitivity: 'base', numeric: true };

export function sortQuickAccessProjects<T extends { name: string }>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, NAME_COLLATOR));
}

export function initialQuickAccessSelection(
  starred: readonly { path: string }[],
  initialRepoPath: string
): string[] {
  if (!initialRepoPath) return [];
  return starred.some((project) => project.path === initialRepoPath) ? [initialRepoPath] : [];
}

export function spawnCwdTargets(
  selectedPaths: readonly string[],
  starred: readonly { path: string; name: string }[],
  typedPath: string
): string[] {
  const selected = new Set(selectedPaths.filter((path) => path !== ''));
  if (selected.size === 0) return [typedPath.trim()];
  return sortQuickAccessProjects(starred)
    .map((project) => project.path)
    .filter((path) => selected.has(path));
}

/**
 * A ticket or goal belongs to one project. A single launch keeps the binding
 * even if the working directory was edited; fan-out copies the instruction,
 * not the binding — only the home working directory keeps it.
 */
export function ticketAndGoalForCwd(
  cwd: string,
  homePath: string,
  ticketId: string | null | undefined,
  goalId: string,
  fanout: boolean
): { spawnedByTicketId?: string; spawnedByGoalId?: string } {
  if (fanout && (!homePath || cwd !== homePath)) return {};
  return {
    ...(ticketId ? { spawnedByTicketId: ticketId } : {}),
    ...(goalId ? { spawnedByGoalId: goalId } : {}),
  };
}
