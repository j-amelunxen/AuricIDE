import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffSource } from './diffTab';
import type { GitFileStatus } from '@/lib/tauri/git';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockStageFiles = vi.fn();
const mockGetGitDiff = vi.fn();
const mockGetGitDiffFileRef = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

vi.mock('@/lib/tauri/git', () => ({
  stageFiles: (...args: unknown[]) => mockStageFiles(...args),
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
  getGitDiffFileRef: (...args: unknown[]) => mockGetGitDiffFileRef(...args),
}));

import {
  applyDiffLineEdit,
  canEditStagedAgainstWorktree,
  isEditableDiffSource,
  LineEditError,
  reloadDiffPatch,
  replaceFileLine,
} from './applyLineEdit';

describe('isEditableDiffSource', () => {
  it.each<[DiffSource, boolean]>([
    [{ kind: 'unstaged' }, true],
    [{ kind: 'combined' }, true],
    [{ kind: 'staged' }, true],
    [{ kind: 'revision', oid: 'abc', summary: 'wip' }, false],
    [{ kind: 'ref', ref: 'main' }, false],
  ])('%j → %s', (source, expected) => {
    expect(isEditableDiffSource(source)).toBe(expected);
  });
});

describe('canEditStagedAgainstWorktree', () => {
  const file = (unstaged: GitFileStatus['unstaged']): GitFileStatus => ({
    path: 'src/a.ts',
    status: 'modified',
    staged: 'modified',
    unstaged,
  });

  it('allows a staged file that matches the worktree', () => {
    expect(canEditStagedAgainstWorktree(file(null))).toBe(true);
  });

  it('allows a missing status row (treat as aligned)', () => {
    expect(canEditStagedAgainstWorktree(undefined)).toBe(true);
  });

  it('refuses a staged file that also has unstaged drift', () => {
    expect(canEditStagedAgainstWorktree(file('modified'))).toBe(false);
  });
});

describe('replaceFileLine', () => {
  it('replaces a 1-based line and keeps a trailing newline', () => {
    expect(replaceFileLine('line1\nline2\nline3\n', 2, 'line2', 'changed')).toBe(
      'line1\nchanged\nline3\n'
    );
  });

  it('keeps a file that had no trailing newline', () => {
    expect(replaceFileLine('line1\nline2', 2, 'line2', 'changed')).toBe('line1\nchanged');
  });

  it('preserves CRLF', () => {
    expect(replaceFileLine('line1\r\nline2\r\n', 1, 'line1', 'hello')).toBe('hello\r\nline2\r\n');
  });

  it('turns one line into several when the replacement has newlines', () => {
    expect(replaceFileLine('a\nb\nc\n', 2, 'b', 'b1\nb2')).toBe('a\nb1\nb2\nc\n');
  });

  it('throws when the line number is out of range', () => {
    expect(() => replaceFileLine('only\n', 3, 'only', 'x')).toThrow(LineEditError);
    expect(() => replaceFileLine('only\n', 3, 'only', 'x')).toThrow(/out of range/i);
  });

  it('throws when the file no longer matches the reviewed line', () => {
    expect(() => replaceFileLine('alpha\nbeta\n', 2, 'new line', 'gamma')).toThrow(LineEditError);
    expect(() => replaceFileLine('alpha\nbeta\n', 2, 'new line', 'gamma')).toThrow(/changed/i);
  });

  it('is a no-op when the replacement equals the current line', () => {
    expect(replaceFileLine('keep\n', 1, 'keep', 'keep')).toBe('keep\n');
  });
});

describe('applyDiffLineEdit', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockStageFiles.mockReset();
    mockReadFile.mockResolvedValue('line1\nold line\nline3\n');
    mockWriteFile.mockResolvedValue(undefined);
    mockStageFiles.mockResolvedValue(undefined);
  });

  it('writes the replaced file at repoPath/filePath', async () => {
    await applyDiffLineEdit({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      lineNo: 2,
      expected: 'old line',
      nextText: 'new line',
      restage: false,
    });

    expect(mockReadFile).toHaveBeenCalledWith('/repo/src/a.ts');
    expect(mockWriteFile).toHaveBeenCalledWith('/repo/src/a.ts', 'line1\nnew line\nline3\n');
    expect(mockStageFiles).not.toHaveBeenCalled();
  });

  it('restages the file after a staged-diff edit', async () => {
    await applyDiffLineEdit({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      lineNo: 2,
      expected: 'old line',
      nextText: 'new line',
      restage: true,
    });

    expect(mockStageFiles).toHaveBeenCalledWith('/repo', ['src/a.ts']);
  });

  it('does not write when the line is unchanged', async () => {
    await applyDiffLineEdit({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      lineNo: 1,
      expected: 'line1',
      nextText: 'line1',
      restage: false,
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockStageFiles).not.toHaveBeenCalled();
  });

  it('does not write when the reviewed line no longer matches the file', async () => {
    mockReadFile.mockResolvedValue('line1\ndrifted\nline3\n');

    await expect(
      applyDiffLineEdit({
        repoPath: '/repo',
        filePath: 'src/a.ts',
        lineNo: 2,
        expected: 'old line',
        nextText: 'new line',
        restage: false,
      })
    ).rejects.toBeInstanceOf(LineEditError);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('reloadDiffPatch', () => {
  beforeEach(() => {
    mockGetGitDiff.mockReset();
    mockGetGitDiffFileRef.mockReset();
    mockGetGitDiff.mockResolvedValue('patched');
    mockGetGitDiffFileRef.mockResolvedValue('from-ref');
  });

  it('asks for the staged/unstaged side when the tab has one', async () => {
    await reloadDiffPatch('/repo', 'a.ts', { kind: 'staged' });
    expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'a.ts', 'staged');
  });

  it('asks for the combined worktree patch without a side', async () => {
    await reloadDiffPatch('/repo', 'a.ts', { kind: 'combined' });
    expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'a.ts', undefined);
  });

  it('refetches a compare-ref tab against that ref', async () => {
    await expect(
      reloadDiffPatch('/repo', 'a.ts', { kind: 'ref', ref: 'origin/main' })
    ).resolves.toBe('from-ref');
    expect(mockGetGitDiffFileRef).toHaveBeenCalledWith('/repo', 'origin/main', 'a.ts');
  });
});
