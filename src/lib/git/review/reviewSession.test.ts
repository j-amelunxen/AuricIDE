import { describe, expect, it } from 'vitest';
import type { RiskFlag } from './riskFlags';
import {
  isReviewTabId,
  orderReviewFiles,
  parseReviewTabId,
  patchHash,
  reviewProgress,
  reviewTabId,
  viewedState,
  type ReviewFile,
  type ReviewSource,
} from './reviewSession';

function file(path: string, overrides: Partial<ReviewFile> = {}): ReviewFile {
  return { path, status: 'modified', patch: '', flags: [], hash: `h-${path}`, ...overrides };
}

const flag = (kind: RiskFlag['kind']): RiskFlag => ({ kind, label: kind });

describe('reviewTabId', () => {
  it('builds review:<repoPath>:<sourceKey> for both source kinds', () => {
    expect(reviewTabId({ kind: 'worktree', repoPath: '/work/repo' })).toBe(
      'review:/work/repo:worktree'
    );
    expect(reviewTabId({ kind: 'ref', repoPath: '/work/repo', ref: 'origin/main' })).toBe(
      'review:/work/repo:ref=origin%2Fmain'
    );
  });

  it('is recognised by isReviewTabId and not confused with diff or merge tabs', () => {
    expect(isReviewTabId('review:/r:worktree')).toBe(true);
    expect(isReviewTabId('diff:unstaged:/r:a.ts')).toBe(false);
    expect(isReviewTabId('merge:/r')).toBe(false);
  });

  it.each<ReviewSource>([
    { kind: 'worktree', repoPath: '/work/repo' },
    { kind: 'ref', repoPath: '/work/repo', ref: 'feature/a:b' },
    { kind: 'ref', repoPath: '/odd:path/repo', ref: 'main' },
  ])('round-trips through parseReviewTabId: %o', (source) => {
    expect(parseReviewTabId(reviewTabId(source))).toEqual(source);
  });

  it('parses foreign ids to null', () => {
    expect(parseReviewTabId('diff:unstaged:/r:a.ts')).toBeNull();
    expect(parseReviewTabId('review:/r:unknown')).toBeNull();
  });
});

describe('patchHash', () => {
  const patch = (index: string, header: string, body: string[]) =>
    [
      'diff --git a/a.ts b/a.ts',
      `index ${index} 100644`,
      '--- a/a.ts',
      '+++ b/a.ts',
      header,
      ...body,
      '',
    ].join('\n');

  it('is stable for the same patch', () => {
    const p = patch('1111111..2222222', '@@ -1,2 +1,2 @@', [' a', '-b', '+c']);
    expect(patchHash(p)).toBe(patchHash(p));
  });

  it('ignores header noise: index line and hunk line numbers', () => {
    const a = patch('1111111..2222222', '@@ -1,2 +1,2 @@', [' a', '-b', '+c']);
    const b = patch('3333333..4444444', '@@ -7,2 +7,2 @@ function f() {', [' a', '-b', '+c']);
    expect(patchHash(a)).toBe(patchHash(b));
  });

  it('changes when a body line changes', () => {
    const a = patch('1111111..2222222', '@@ -1,2 +1,2 @@', [' a', '-b', '+c']);
    const b = patch('1111111..2222222', '@@ -1,2 +1,2 @@', [' a', '-b', '+d']);
    expect(patchHash(a)).not.toBe(patchHash(b));
  });

  it('changes when the same lines are split into hunks differently', () => {
    const one = ['@@ -1 +1 @@', '+a', '+b'].join('\n');
    const two = ['@@ -1 +1 @@', '+a', '@@ -9 +9 @@', '+b'].join('\n');
    expect(patchHash(one)).not.toBe(patchHash(two));
  });

  it('tells binary changes apart by their index line, since they have no body', () => {
    const bin = (index: string) =>
      [
        'diff --git a/x.png b/x.png',
        `index ${index} 100644`,
        'Binary files a/x.png and b/x.png differ',
      ].join('\n');
    expect(patchHash(bin('1111111..2222222'))).not.toBe(patchHash(bin('1111111..3333333')));
  });

  it('returns a short hex string', () => {
    expect(patchHash('@@ -1 +1 @@\n+a')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('viewedState and reviewProgress', () => {
  const files = [file('a.ts', { hash: 'h1' }), file('b.ts', { hash: 'h2' }), file('c.ts')];
  const marks = { 'a.ts': 'h1', 'b.ts': 'old' };

  it('says viewed only for the exact version that was seen', () => {
    expect(viewedState(files[0], marks)).toBe('viewed');
    expect(viewedState(files[1], marks)).toBe('changed-since-viewed');
    expect(viewedState(files[2], marks)).toBe('unviewed');
    expect(viewedState(files[2], undefined)).toBe('unviewed');
  });

  it('counts viewed, changed since viewed and total', () => {
    expect(reviewProgress(files, marks)).toEqual({ viewed: 1, changed: 1, total: 3 });
    expect(reviewProgress([], undefined)).toEqual({ viewed: 0, changed: 0, total: 0 });
  });
});

describe('orderReviewFiles', () => {
  it('puts risk first, lockfiles and generated files last, path order otherwise', () => {
    const ordered = orderReviewFiles([
      file('pnpm-lock.yaml', { flags: [flag('lockfile')] }),
      file('src/z.ts'),
      file('dist/app.js', { flags: [flag('generated')] }),
      file('src/a.ts'),
      file('src/escape.ts', { flags: [flag('type-escape')] }),
      file('src/secret.ts', { flags: [flag('secret-like')] }),
    ]);
    expect(ordered.map((f) => f.path)).toEqual([
      'src/secret.ts',
      'src/escape.ts',
      'src/a.ts',
      'src/z.ts',
      'dist/app.js',
      'pnpm-lock.yaml',
    ]);
  });

  it('keeps a lockfile last even if a path rule did not flag it', () => {
    const ordered = orderReviewFiles([file('Cargo.lock'), file('src/b.rs')]);
    expect(ordered.map((f) => f.path)).toEqual(['src/b.rs', 'Cargo.lock']);
  });

  it('does not mutate its input', () => {
    const input = [file('b.ts'), file('a.ts')];
    orderReviewFiles(input);
    expect(input.map((f) => f.path)).toEqual(['b.ts', 'a.ts']);
  });
});
