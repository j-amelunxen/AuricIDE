import { describe, expect, it } from 'vitest';
import type { GitFileStatus } from '@/lib/tauri/git';
import { isConflicted, isStaged, isUnstagedTracked, isUntracked } from './statusSplit';

function row(
  partial: Partial<GitFileStatus> & Pick<GitFileStatus, 'path' | 'status'>
): GitFileStatus {
  return { staged: null, unstaged: null, ...partial };
}

describe('statusSplit', () => {
  it('treats a file as staged only when staged is set', () => {
    expect(isStaged(row({ path: 'a.ts', status: 'modified', staged: 'modified' }))).toBe(true);
    expect(isStaged(row({ path: 'a.ts', status: 'modified', unstaged: 'modified' }))).toBe(false);
  });

  it('treats modified and deleted worktree changes as unstaged-tracked', () => {
    expect(isUnstagedTracked(row({ path: 'a.ts', status: 'modified', unstaged: 'modified' }))).toBe(
      true
    );
    expect(isUnstagedTracked(row({ path: 'a.ts', status: 'deleted', unstaged: 'deleted' }))).toBe(
      true
    );
    expect(
      isUnstagedTracked(row({ path: 'a.ts', status: 'untracked', unstaged: 'untracked' }))
    ).toBe(false);
    expect(isUnstagedTracked(row({ path: 'a.ts', status: 'added', staged: 'added' }))).toBe(false);
  });

  it('treats only untracked worktree files as untracked', () => {
    expect(isUntracked(row({ path: 'a.ts', status: 'untracked', unstaged: 'untracked' }))).toBe(
      true
    );
    expect(isUntracked(row({ path: 'a.ts', status: 'modified', unstaged: 'modified' }))).toBe(
      false
    );
  });

  it('counts a both-sides file as staged and unstaged-tracked', () => {
    const both = row({
      path: 'a.ts',
      status: 'modified',
      staged: 'modified',
      unstaged: 'modified',
    });
    expect(isStaged(both)).toBe(true);
    expect(isUnstagedTracked(both)).toBe(true);
    expect(isUntracked(both)).toBe(false);
  });

  it('keeps a conflicted file out of every ordinary list', () => {
    const conflicted = row({ path: 'a.ts', status: 'conflicted', unstaged: 'conflicted' });
    expect(isConflicted(conflicted)).toBe(true);
    expect(isStaged(conflicted)).toBe(false);
    expect(isUnstagedTracked(conflicted)).toBe(false);
    expect(isUntracked(conflicted)).toBe(false);
  });

  it('treats a conflicted status as conflicted even if a staged side slipped in', () => {
    const odd = row({ path: 'a.ts', status: 'conflicted', staged: 'modified' });
    expect(isConflicted(odd)).toBe(true);
    expect(isStaged(odd)).toBe(false);
    expect(isConflicted(row({ path: 'a.ts', status: 'modified', unstaged: 'modified' }))).toBe(
      false
    );
  });
});
