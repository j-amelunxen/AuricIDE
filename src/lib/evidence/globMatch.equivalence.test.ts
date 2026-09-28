import { describe, expect, it } from 'vitest';
import { globMatch } from './engine';

// globMatch runs once per project file for every file_exists station on every
// sweep. It was made cheaper; this pins it to the previous implementation,
// kept here verbatim, over a large random set of globs and paths.
function referenceGlobMatch(glob: string, path: string): boolean {
  if (typeof glob !== 'string' || typeof path !== 'string') return false;
  if (glob.length > 512) return false;
  const starts = [0];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '/') starts.push(i + 1);
  }
  return starts.some((s) => anchored(glob, path.slice(s)));
}

function anchored(glob: string, text: string): boolean {
  const g = glob.length;
  const t = text.length;
  const memo: (boolean | undefined)[][] = Array.from({ length: g + 1 }, () =>
    new Array<boolean | undefined>(t + 1).fill(undefined)
  );
  const solve = (gi: number, ti: number): boolean => {
    const cached = memo[gi][ti];
    if (cached !== undefined) return cached;
    let res: boolean;
    if (gi === g) res = ti === t;
    else if (glob[gi] === '*' && glob[gi + 1] === '*')
      res = solve(gi + 2, ti) || (ti < t && solve(gi, ti + 1));
    else if (glob[gi] === '*')
      res = solve(gi + 1, ti) || (ti < t && text[ti] !== '/' && solve(gi, ti + 1));
    else if (glob[gi] === '?') res = ti < t && text[ti] !== '/' && solve(gi + 1, ti + 1);
    else res = ti < t && glob[gi] === text[ti] && solve(gi + 1, ti + 1);
    memo[gi][ti] = res;
    return res;
  };
  return solve(0, 0);
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('globMatch equivalence', () => {
  it('decides exactly like the previous implementation', () => {
    const rand = rng(3);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const pathParts = ['a', 'b', 'src', 'out', 'x.md', 'a.txt', 'ab', '', 'b.md'];
    const globParts = ['a', 'b', 'src', 'out', '*', '**', '?', '.md', 'x', '/', '*.md', 'a*b'];
    let matches = 0;
    for (let run = 0; run < 20000; run++) {
      const path = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(pathParts)).join(
        '/'
      );
      const glob = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(globParts)).join(
        rand() < 0.5 ? '/' : ''
      );
      const expected = referenceGlobMatch(glob, path);
      if (expected) matches++;
      expect(globMatch(glob, path), `${glob} vs ${path}`).toBe(expected);
    }
    // The random set must exercise both outcomes to mean anything.
    expect(matches).toBeGreaterThan(1000);
  });
});
