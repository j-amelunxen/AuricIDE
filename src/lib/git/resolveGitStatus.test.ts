import { describe, expect, it } from 'vitest';
import { resolveGitStatus, resolveGitStatusForPath } from './resolveGitStatus';
import type { GitFileStatus, GitRepoRef } from '@/lib/tauri/git';

function row(
  path: string,
  status: GitFileStatus['status'],
  staged: GitFileStatus['staged'] = null,
  unstaged: GitFileStatus['unstaged'] = null
): GitFileStatus {
  return { path, status, staged, unstaged };
}

const statuses = (entries: GitFileStatus[]) => entries;

describe('resolveGitStatus', () => {
  it('maps an exact ignored file', () => {
    expect(resolveGitStatus('secret.txt', statuses([row('secret.txt', 'ignored')]))).toBe(
      'ignored'
    );
  });

  it('greys out a folder when git reports it with a trailing slash', () => {
    expect(resolveGitStatus('build', statuses([row('build/', 'ignored')]))).toBe('ignored');
  });

  it('still matches when both sides have no trailing slash', () => {
    expect(resolveGitStatus('node_modules', statuses([row('node_modules', 'ignored')]))).toBe(
      'ignored'
    );
  });

  it('treats files inside an ignored folder as ignored', () => {
    expect(resolveGitStatus('build/out.js', statuses([row('build/', 'ignored')]))).toBe('ignored');
  });

  it('does not treat a sibling prefix as the same folder', () => {
    expect(resolveGitStatus('build-tools', statuses([row('build/', 'ignored')]))).toBeUndefined();
  });

  it('still maps modified and added files by exact path', () => {
    expect(
      resolveGitStatus('src/a.ts', statuses([row('src/a.ts', 'modified', null, 'modified')]))
    ).toBe('modified');
    expect(
      resolveGitStatus('src/b.ts', statuses([row('src/b.ts', 'untracked', null, 'untracked')]))
    ).toBe('added');
  });

  it('badges a both-sides file as modified from the collapse status', () => {
    expect(
      resolveGitStatus('src/a.ts', statuses([row('src/a.ts', 'modified', 'modified', 'modified')]))
    ).toBe('modified');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveGitStatus('src/clean.ts', statuses([]))).toBeUndefined();
  });
});

describe('resolveGitStatusForPath', () => {
  function repo(
    path: string,
    relativePath: string,
    name: string,
    kind: GitRepoRef['kind']
  ): GitRepoRef {
    return { path, relativePath, name, kind };
  }

  const workspace = repo('/w', '', 'w', 'root');
  const api = repo('/w/api', 'api', 'api', 'nested');
  const repos = [workspace, api];

  it('resolves a file in the root repo through that repo statuses', () => {
    const statusesByRepo = {
      '/w': [row('README.md', 'modified', null, 'modified')],
    };
    expect(resolveGitStatusForPath('/w/README.md', repos, statusesByRepo)).toBe('modified');
  });

  it('resolves a file in a nested repo through that repo statuses, not the outer repo', () => {
    const statusesByRepo = {
      '/w': [row('api/', 'untracked')],
      '/w/api': [row('src/main.rs', 'modified', null, 'modified')],
    };
    expect(resolveGitStatusForPath('/w/api/src/main.rs', repos, statusesByRepo)).toBe('modified');
  });

  it('gives a nested repo own directory no badge from the enclosing repo', () => {
    const statusesByRepo = {
      '/w': [row('api/', 'untracked')],
      '/w/api': [],
    };
    expect(resolveGitStatusForPath('/w/api', repos, statusesByRepo)).toBeUndefined();
  });

  it('returns undefined when the path is outside every known repo', () => {
    expect(resolveGitStatusForPath('/elsewhere/file.ts', repos, {})).toBeUndefined();
  });

  it('returns undefined when the repo has no status entry recorded yet', () => {
    expect(resolveGitStatusForPath('/w/README.md', repos, {})).toBeUndefined();
  });
});
