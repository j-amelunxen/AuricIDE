import type { GitRef, GitRefs } from '@/lib/tauri/gitGraph';

const KIND_RANK: Record<GitRef['kind'], number> = { head: 4, local: 1, remote: 2, tag: 3 };

/** Current branch first, then local, remote, tags, each by name. */
export function orderRefsForRow(refs: GitRef[]): GitRef[] {
  return [...refs].sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.shorthand.localeCompare(b.shorthand)
  );
}

/** Refs per commit. The bare HEAD marker is drawn only when HEAD is not on a branch. */
export function refsByOid(refs: GitRefs | null): Map<string, GitRef[]> {
  const map = new Map<string, GitRef[]>();
  if (!refs) return map;
  for (const ref of refs.refs) {
    if (ref.kind === 'head' && !refs.headDetached) continue;
    map.set(ref.target, [...(map.get(ref.target) ?? []), ref]);
  }
  for (const [oid, list] of map) map.set(oid, orderRefsForRow(list));
  return map;
}

const KIND_WORD: Record<GitRef['kind'], string> = {
  local: 'branch',
  remote: 'remote',
  tag: 'tag',
  head: 'HEAD',
};

/** "branch main, current", "remote origin/main", "tag v1": the kind is part of the name. */
export function refAriaLabel(ref: GitRef): string {
  if (ref.kind === 'head') return 'HEAD';
  return `${KIND_WORD[ref.kind]} ${ref.shorthand}${ref.isCurrent ? ', current' : ''}`;
}

export function rowAriaLabel(
  summary: string,
  author: string,
  date: string,
  refs: GitRef[]
): string {
  return [summary, author, date, ...refs.map(refAriaLabel)].join(', ');
}
