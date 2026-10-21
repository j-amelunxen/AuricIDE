import type { GitRef, GraphCommit } from '../tauri/gitGraph';

const MIN_SHA_PREFIX = 4;
const HEX = /^[0-9a-f]+$/;

/**
 * Oids of the commits matching `query`, in row order. Matches summary, author
 * name or email, a sha prefix (4+ hex characters) and the shorthand of any ref
 * pointing at the commit. Case-insensitive; an empty query matches nothing.
 */
export function matchingOids(commits: GraphCommit[], refs: GitRef[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const refNamesByOid = new Map<string, string[]>();
  for (const ref of refs) {
    const names = refNamesByOid.get(ref.target) ?? [];
    names.push(ref.shorthand.toLowerCase());
    refNamesByOid.set(ref.target, names);
  }

  const isShaPrefix = needle.length >= MIN_SHA_PREFIX && HEX.test(needle);
  return commits
    .filter(
      (c) =>
        (isShaPrefix && c.oid.startsWith(needle)) ||
        c.summary.toLowerCase().includes(needle) ||
        c.authorName.toLowerCase().includes(needle) ||
        c.authorEmail.toLowerCase().includes(needle) ||
        (refNamesByOid.get(c.oid) ?? []).some((name) => name.includes(needle))
    )
    .map((c) => c.oid);
}
