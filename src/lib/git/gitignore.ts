/**
 * Helpers for the explorer's "Add to .gitignore" action. Kept pure so the
 * rules are testable without touching the file system.
 */

/** Strip a trailing slash so `/build` and `/build/` compare as the same rule. */
function normalizeRule(line: string): string {
  const trimmed = line.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Turn an absolute explorer path into a pattern for the root `.gitignore`.
 *
 * The pattern is anchored with a leading `/` so it only ever matches the
 * object that was right-clicked — a bare `notes.md` would ignore every file
 * of that name anywhere in the repo. Directories get a trailing slash, the
 * git convention for "directory only".
 *
 * Returns `null` when the path is not inside the project (nothing sensible
 * to write) or when it *is* the project root.
 */
export function toGitignoreEntry(
  rootPath: string | null | undefined,
  absolutePath: string,
  isDirectory: boolean
): string | null {
  if (!rootPath || !absolutePath) return null;
  const root = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
  if (!absolutePath.startsWith(root + '/')) return null;
  const relative = absolutePath.slice(root.length + 1);
  if (!relative) return null;
  return `/${relative}${isDirectory ? '/' : ''}`;
}

/**
 * Append `entry` as its own line to existing `.gitignore` content.
 *
 * Returns `null` when the rule is already present, so the caller can tell the
 * user instead of writing a duplicate. Comments are never treated as rules.
 */
export function appendGitignoreEntry(content: string, entry: string): string | null {
  const target = normalizeRule(entry);
  const alreadyListed = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .some((line) => normalizeRule(line) === target);
  if (alreadyListed) return null;

  if (content.length === 0) return `${entry}\n`;
  return content.endsWith('\n') ? `${content}${entry}\n` : `${content}\n${entry}\n`;
}
