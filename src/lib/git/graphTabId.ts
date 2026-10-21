const PREFIX = 'git-graph:';

/** Tab id of the git graph browser for one repository. */
export function graphTabId(repoPath: string): string {
  return `${PREFIX}${repoPath}`;
}

export function isGraphTabId(id: string): boolean {
  return id.startsWith(PREFIX);
}

export function repoPathFromGraphTabId(id: string): string | null {
  return isGraphTabId(id) ? id.slice(PREFIX.length) : null;
}
