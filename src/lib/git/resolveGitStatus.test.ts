import { describe, expect, it } from 'vitest';
import { resolveGitStatus } from './resolveGitStatus';
import type { GitFileStatus } from '@/lib/tauri/git';

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
