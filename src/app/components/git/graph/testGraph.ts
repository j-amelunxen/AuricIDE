import { layoutGraph } from '@/lib/git/graphLayout';
import type { GitRef, GitRefs, GraphCommit } from '@/lib/tauri/gitGraph';

export const oidOf = (i: number) => `c${i}`;

export function makeCommit(
  i: number,
  parents: string[],
  over: Partial<GraphCommit> = {}
): GraphCommit {
  return {
    oid: oidOf(i),
    parents,
    summary: `Commit number ${i}`,
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    authorTime: 1_760_000_000 - i * 3600,
    committerTime: 1_760_000_000 - i * 3600,
    ...over,
  };
}

/** A straight history, newest first: c0 -> c1 -> ... -> c(n-1). */
export function linearCommits(count: number): GraphCommit[] {
  return Array.from({ length: count }, (_, i) =>
    makeCommit(i, i === count - 1 ? [] : [oidOf(i + 1)])
  );
}

export function laidOut(commits: GraphCommit[], headOid: string | null = commits[0]?.oid ?? null) {
  return layoutGraph(commits, headOid).rows;
}

export function makeRef(
  shorthand: string,
  kind: GitRef['kind'],
  target: string,
  isCurrent = false
): GitRef {
  const prefix = { local: 'refs/heads/', remote: 'refs/remotes/', tag: 'refs/tags/', head: '' }[
    kind
  ];
  return {
    name: kind === 'head' ? 'HEAD' : `${prefix}${shorthand}`,
    shorthand,
    kind,
    target,
    upstream: null,
    ahead: null,
    behind: null,
    isCurrent,
  };
}

export function makeRefs(refs: GitRef[], over: Partial<GitRefs> = {}): GitRefs {
  return {
    refs,
    headDetached: false,
    headOid: refs.find((r) => r.isCurrent)?.target ?? null,
    operation: 'none',
    ...over,
  };
}
