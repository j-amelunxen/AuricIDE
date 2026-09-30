// Store-free so the MCP server can match station globs exactly as the
// frontend does. Re-exported from engine.ts for existing importers.

/** Longest glob we will even look at. A predicate glob is a path pattern, not
 * a program; anything past this is either a mistake or an attack. */
const GLOB_MAX_LEN = 512;

/**
 * Segment-aware glob match with no regex, so a hostile pattern cannot trigger
 * catastrophic backtracking. `**a**a…b` compiled to `.*a.*a…` once froze the
 * renderer for tens of seconds against a long non-matching path; this runs in
 * O(|glob|·|path|) via a memo table instead. Semantics match the old regex:
 * `*` within a segment, `**` across segments, `?` one non-slash char, anchored
 * to the end and allowed to begin at any segment boundary. A non-string or
 * over-long glob is a non-match, never a throw.
 */
export function globMatch(glob: string, path: string): boolean {
  if (typeof glob !== 'string' || typeof path !== 'string') return false;
  if (glob.length > GLOB_MAX_LEN) return false;
  // The match is anchored to the end, so whatever literal text follows the
  // glob's last wildcard has to be how the path ends. Checking that first
  // turns the common miss — one station glob against every project file —
  // into a string comparison instead of a table walk per segment.
  if (!path.endsWith(literalTail(glob))) return false;
  // Candidate starts: index 0 and every index just past a '/', mirroring the
  // old `(^|/)` anchor.
  if (anchoredGlobMatch(glob, path)) return true;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '/' && anchoredGlobMatch(glob, path.slice(i + 1))) return true;
  }
  return false;
}

/** The glob's text after its last wildcard (`*` or `?`); all of it if none. */
function literalTail(glob: string): string {
  const last = Math.max(glob.lastIndexOf('*'), glob.lastIndexOf('?'));
  return glob.slice(last + 1);
}

/** True if `glob` matches the whole of `text` (end-anchored), computed with a
 * memo table so no (glob, text) position pair is explored more than once. The
 * table is one flat typed array: 0 unknown, 1 no, 2 yes. */
function anchoredGlobMatch(glob: string, text: string): boolean {
  const g = glob.length;
  const t = text.length;
  const width = t + 1;
  const memo = new Uint8Array((g + 1) * width);
  const solve = (gi: number, ti: number): boolean => {
    const cached = memo[gi * width + ti];
    if (cached !== 0) return cached === 2;
    let res: boolean;
    if (gi === g) {
      res = ti === t;
    } else if (glob[gi] === '*' && glob[gi + 1] === '*') {
      // ** : consume any char including '/', or nothing.
      res = solve(gi + 2, ti) || (ti < t && solve(gi, ti + 1));
    } else if (glob[gi] === '*') {
      // * : consume any non-'/' char, or nothing.
      res = solve(gi + 1, ti) || (ti < t && text[ti] !== '/' && solve(gi, ti + 1));
    } else if (glob[gi] === '?') {
      res = ti < t && text[ti] !== '/' && solve(gi + 1, ti + 1);
    } else {
      res = ti < t && glob[gi] === text[ti] && solve(gi + 1, ti + 1);
    }
    memo[gi * width + ti] = res ? 2 : 1;
    return res;
  };
  return solve(0, 0);
}
