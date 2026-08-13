import { describe, expect, it } from 'vitest';
import { resolveGitStatus } from './resolveGitStatus';
import type { GitFileStatus } from '@/lib/tauri/git';

const statuses = (entries: GitFileStatus[]) => entries;

describe('resolveGitStatus', () => {
  it('maps an exact ignored file', () => {
    expect(
      resolveGitStatus('secret.txt', statuses([{ path: 'secret.txt', status: 'ignored' }]))
    ).toBe('ignored');
  });

  it('greys out a folder when git reports it with a trailing slash', () => {
    expect(resolveGitStatus('build', statuses([{ path: 'build/', status: 'ignored' }]))).toBe(
      'ignored'
    );
  });

  it('still matches when both sides have no trailing slash', () => {
    expect(
      resolveGitStatus('node_modules', statuses([{ path: 'node_modules', status: 'ignored' }]))
    ).toBe('ignored');
  });

  it('treats files inside an ignored folder as ignored', () => {
    expect(
      resolveGitStatus('build/out.js', statuses([{ path: 'build/', status: 'ignored' }]))
    ).toBe('ignored');
  });

  it('does not treat a sibling prefix as the same folder', () => {
    expect(
      resolveGitStatus('build-tools', statuses([{ path: 'build/', status: 'ignored' }]))
    ).toBeUndefined();
  });

  it('still maps modified and added files by exact path', () => {
    expect(resolveGitStatus('src/a.ts', statuses([{ path: 'src/a.ts', status: 'modified' }]))).toBe(
      'modified'
    );
    expect(
      resolveGitStatus('src/b.ts', statuses([{ path: 'src/b.ts', status: 'untracked' }]))
    ).toBe('added');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveGitStatus('src/clean.ts', statuses([]))).toBeUndefined();
  });
});
