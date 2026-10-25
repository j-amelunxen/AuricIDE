import { describe, expect, it } from 'vitest';
import { tabBreadcrumbs } from './tabBreadcrumbs';

describe('tabBreadcrumbs', () => {
  it('shows only the app name without an active tab', () => {
    expect(tabBreadcrumbs(null, undefined)).toEqual(['AuricIDE']);
  });

  it('splits a file path', () => {
    expect(tabBreadcrumbs('/work/app/src/a.ts', undefined)).toEqual([
      'AuricIDE',
      'work',
      'app',
      'src',
      'a.ts',
    ]);
  });

  it('names a diff tab by its file, never by the raw tab id', () => {
    const id = 'diff:unstaged:/private/var/folders/x/repo:docs/hunks.txt';
    expect(tabBreadcrumbs(id, { id, path: 'docs/hunks.txt', name: 'hunks.txt (diff)' })).toEqual([
      'AuricIDE',
      'Diff',
      'docs',
      'hunks.txt',
    ]);
  });

  it('names a file comparison by its tab name, never by the encoded paths in its id', () => {
    const id = 'diff:files:%2Fp%2Fa.ts:%2Fp%2Fb.ts';
    expect(tabBreadcrumbs(id, { id, path: 'a.ts ↔ b.ts', name: 'a.ts ↔ b.ts' })).toEqual([
      'AuricIDE',
      'Compare',
      'a.ts ↔ b.ts',
    ]);
  });

  it('names a graph tab by its title, never by the repo path in its id', () => {
    const id = 'git-graph:/private/var/folders/x/repo';
    expect(
      tabBreadcrumbs(id, { id, path: '/private/var/folders/x/repo', name: 'repo Graph' })
    ).toEqual(['AuricIDE', 'repo Graph']);
  });

  it('names a merge tab by its repo-relative file', () => {
    const id = 'merge:/repo:src/invoice.txt';
    expect(
      tabBreadcrumbs(id, { id, path: 'src/invoice.txt', name: 'invoice.txt (merge)' })
    ).toEqual(['AuricIDE', 'Merge', 'src', 'invoice.txt']);
  });

  it('names a review tab by its tab name', () => {
    const id = 'review:/repo:worktree';
    expect(tabBreadcrumbs(id, { id, path: '/repo', name: 'Review: repo' })).toEqual([
      'AuricIDE',
      'Review: repo',
    ]);
  });

  it('falls back to a label when a virtual tab is not in the tab list', () => {
    expect(tabBreadcrumbs('diff:staged:/repo:a.ts', undefined)).toEqual(['AuricIDE', 'Diff']);
  });
});
