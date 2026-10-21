import { describe, expect, it } from 'vitest';
import type { GitRef, GitRefs, GraphCommit } from '@/lib/tauri/gitGraph';
import { countCommitsOnlyReachableFrom, describeOperation, shortSummary } from './graphCopy';

const commit = (oid: string, parents: string[] = []): GraphCommit => ({
  oid,
  parents,
  summary: oid,
  authorName: 'A',
  authorEmail: 'a@x',
  authorTime: 0,
  committerTime: 0,
});

const ref = (shorthand: string, kind: GitRef['kind'], target: string): GitRef => ({
  name: kind === 'local' ? `refs/heads/${shorthand}` : `refs/tags/${shorthand}`,
  shorthand,
  kind,
  target,
  upstream: null,
  ahead: null,
  behind: null,
  isCurrent: false,
});

const target = { oid: 'abcdef1234567890', summary: 'Fix login' };

describe('describeOperation', () => {
  it('names the real commit and branch for a revert', () => {
    const d = describeOperation({ kind: 'revert', commit: target, currentBranch: 'main' });
    expect(d.title).toBe('Revert “Fix login”?');
    expect(d.body).toBe(
      'Revert “Fix login” on main. This creates one new commit on main. If the change conflicts, the merge panel opens to finish it.'
    );
    expect(d.confirmLabel).toBe('Revert');
    expect(d.destructive).toBe(false);
  });

  it('says so when the revert lands on a detached HEAD', () => {
    const d = describeOperation({ kind: 'revert', commit: target, currentBranch: null });
    expect(d.body).toContain('on the detached HEAD');
    expect(d.body).not.toContain('null');
  });

  it('describes a cherry-pick as applying the change on top of the current branch', () => {
    const d = describeOperation({ kind: 'cherry-pick', commit: target, currentBranch: 'main' });
    expect(d.body).toBe(
      'Apply the change of “Fix login” on top of main. This creates one new commit on main. If the change conflicts, the merge panel opens to finish it.'
    );
    expect(d.confirmLabel).toBe('Cherry-Pick');
  });

  it('explains a detached checkout with the short sha', () => {
    const d = describeOperation({ kind: 'checkout-commit', commit: target });
    expect(d.title).toBe('Check Out “Fix login” (Detached)?');
    expect(d.body).toContain('abcdef1');
    expect(d.body).toContain('not on a branch');
    expect(d.confirmLabel).toBe('Check Out');
  });

  it('makes deleting a branch destructive and names it', () => {
    const d = describeOperation({ kind: 'delete-branch', name: 'feature/x' });
    expect(d.title).toBe('Delete Branch “feature/x”?');
    expect(d.destructive).toBe(true);
    expect(d.confirmLabel).toBe('Delete');
  });

  it('turns the unmerged refusal into a second sheet that counts the lost commits', () => {
    const d = describeOperation({
      kind: 'delete-branch-unmerged',
      name: 'feature/x',
      commitCount: 3,
    });
    expect(d.body).toContain('3 commits');
    expect(d.confirmLabel).toBe('Delete Anyway');
    expect(d.destructive).toBe(true);
  });

  it('uses the singular for one commit', () => {
    const d = describeOperation({ kind: 'delete-branch-unmerged', name: 'x', commitCount: 1 });
    expect(d.body).toContain('1 commit ');
  });

  it('says the tagged commit is untouched when deleting a tag', () => {
    const d = describeOperation({ kind: 'delete-tag', name: 'v1.0' });
    expect(d.title).toBe('Delete Tag “v1.0”?');
    expect(d.body).toContain('commit it points at is not changed');
  });

  it('never uses an em dash', () => {
    const kinds = [
      describeOperation({ kind: 'revert', commit: target, currentBranch: null }),
      describeOperation({ kind: 'delete-branch-unmerged', name: 'a', commitCount: 2 }),
    ];
    for (const d of kinds) expect(`${d.title}${d.body}`).not.toContain('—');
  });
});

describe('shortSummary', () => {
  it('keeps a short summary and cuts a long one with an ellipsis', () => {
    expect(shortSummary('Fix login')).toBe('Fix login');
    const long = 'x'.repeat(200);
    expect(shortSummary(long).length).toBeLessThanOrEqual(60);
    expect(shortSummary(long).endsWith('…')).toBe(true);
  });

  it('shortens the summary inside a sheet title', () => {
    const d = describeOperation({
      kind: 'revert',
      commit: { oid: 'abcdef1234', summary: 'y'.repeat(200) },
      currentBranch: 'main',
    });
    expect(d.title.length).toBeLessThan(90);
  });
});

describe('countCommitsOnlyReachableFrom', () => {
  // main: m2 -> m1 -> root;  feature: f2 -> f1 -> m1
  const commits = [
    commit('m2', ['m1']),
    commit('f2', ['f1']),
    commit('f1', ['m1']),
    commit('m1', ['root']),
    commit('root'),
  ];
  const refs = (extra: GitRef[]): GitRefs => ({
    refs: [ref('main', 'local', 'm2'), ref('feature', 'local', 'f2'), ...extra],
    headDetached: false,
    headOid: 'm2',
    operation: 'none',
  });

  it('counts the commits no other ref reaches', () => {
    const r = refs([]);
    expect(countCommitsOnlyReachableFrom(commits, r, r.refs[1])).toBe(2);
  });

  it('does not count commits another ref still reaches', () => {
    const r = refs([ref('keep', 'local', 'f1')]);
    expect(countCommitsOnlyReachableFrom(commits, r, r.refs[1])).toBe(1);
  });

  it('counts nothing when the branch tip is merged into another ref', () => {
    const r = refs([ref('same', 'local', 'f2')]);
    expect(countCommitsOnlyReachableFrom(commits, r, r.refs[1])).toBe(0);
  });
});
