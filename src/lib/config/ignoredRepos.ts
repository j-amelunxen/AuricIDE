/**
 * Which nested git repos a project hides from discovery, the dirty probe
 * (Quick Access) and the parent repo's status.
 *
 * Twin of `src-tauri/src/ignored_repos.rs`. Both are tested against
 * `ignoredRepos.fixtures.json` so the settings screen and the backend cannot
 * disagree about a path.
 */

function stripSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * A project-relative ignore entry, or `null` when the value is the project
 * root or climbs out of it. The root cannot be ignored: that would turn the
 * opened folder into "no git at all", which is a different setting.
 */
function normalizeIgnoredRepoPath(value: string): string | null {
  let path = value.trim().replace(/\\/g, '/');
  while (path.startsWith('./')) {
    path = path.slice(2);
  }
  path = path.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (!path || path === '.') return null;

  const segments = path.split('/');
  if (segments.some((segment) => segment === '..')) return null;

  return segments.join('/');
}

export function parseIgnoredRepos(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    const path = normalizeIgnoredRepoPath(entry);
    if (path) seen.add(path);
  }
  return [...seen].sort();
}

export function serializeIgnoredRepos(paths: readonly string[]): string {
  return JSON.stringify(parseIgnoredRepos(JSON.stringify(paths)));
}

export function isIgnoredRepoPath(relativePath: string, ignored: readonly string[]): boolean {
  const path = normalizeIgnoredRepoPath(relativePath);
  if (path === null) return false;
  return ignored.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

export function addIgnoredRepo(ignored: readonly string[], path: string): string[] {
  const next = normalizeIgnoredRepoPath(path);
  if (!next) return parseIgnoredRepos(JSON.stringify(ignored));
  return parseIgnoredRepos(JSON.stringify([...ignored, next]));
}

export function removeIgnoredRepo(ignored: readonly string[], path: string): string[] {
  const target = normalizeIgnoredRepoPath(path);
  if (!target) return parseIgnoredRepos(JSON.stringify(ignored));
  return ignored
    .map((entry) => normalizeIgnoredRepoPath(entry))
    .filter((entry): entry is string => entry !== null && entry !== target)
    .sort();
}

/** Project-relative path for an explorer folder, or `null` when it cannot be ignored. */
export function relativePathForIgnore(rootPath: string, absPath: string): string | null {
  const root = stripSlash(rootPath);
  const target = stripSlash(absPath);
  if (!root || target === root) return null;
  if (!target.startsWith(`${root}/`)) return null;
  return normalizeIgnoredRepoPath(target.slice(root.length + 1));
}
