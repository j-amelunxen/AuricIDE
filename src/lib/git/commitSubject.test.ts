import { describe, expect, it, vi } from 'vitest';
import {
  buildCommitSubjectPrompt,
  cleanCommitSubject,
  collectWorktreeDiff,
  fallbackCommitSubject,
  generateCommitSubject,
} from './commitSubject';
import type { GitFileStatus } from '@/lib/tauri/git';

function file(path: string, status: GitFileStatus['status'] = 'modified'): GitFileStatus {
  return {
    path,
    status,
    staged: null,
    unstaged: status === 'untracked' ? 'untracked' : 'modified',
  };
}

describe('cleanCommitSubject', () => {
  it('keeps a plain one-liner as it is', () => {
    expect(cleanCommitSubject('Add retry to the upload queue')).toBe(
      'Add retry to the upload queue'
    );
  });

  it('takes only the first line of a chatty answer', () => {
    expect(cleanCommitSubject('Fix the token refresh\n\nThe old one expired early.')).toBe(
      'Fix the token refresh'
    );
  });

  it('strips quotes, backticks, list markers and a label', () => {
    expect(cleanCommitSubject('  "Fix the token refresh"  ')).toBe('Fix the token refresh');
    expect(cleanCommitSubject('`Fix the token refresh`')).toBe('Fix the token refresh');
    expect(cleanCommitSubject('- Fix the token refresh')).toBe('Fix the token refresh');
    expect(cleanCommitSubject('Commit message: Fix the token refresh')).toBe(
      'Fix the token refresh'
    );
  });

  it('skips a leading code fence', () => {
    expect(cleanCommitSubject('```\nFix the token refresh\n```')).toBe('Fix the token refresh');
  });

  it('drops a trailing period', () => {
    expect(cleanCommitSubject('Fix the token refresh.')).toBe('Fix the token refresh');
  });

  it('cuts an over-long line at a word boundary', () => {
    const long = cleanCommitSubject(`Rework ${'the migration runner '.repeat(8)}completely`);
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(72);
    expect(long!.endsWith(' ')).toBe(false);
    expect(long!.startsWith('Rework the migration runner')).toBe(true);
  });

  it('returns null for an empty or punctuation-only answer', () => {
    expect(cleanCommitSubject('')).toBeNull();
    expect(cleanCommitSubject('\n\n')).toBeNull();
    expect(cleanCommitSubject('...')).toBeNull();
  });
});

describe('fallbackCommitSubject', () => {
  it('names a single file with the verb its status implies', () => {
    expect(fallbackCommitSubject([file('src/lib/git/repos.ts')])).toBe('Update repos.ts');
    expect(fallbackCommitSubject([file('src/new.ts', 'untracked')])).toBe('Add new.ts');
    expect(fallbackCommitSubject([file('src/old.ts', 'deleted')])).toBe('Remove old.ts');
  });

  it('counts the rest when several files changed', () => {
    expect(fallbackCommitSubject([file('a.ts'), file('b.ts'), file('c.ts')])).toBe(
      'Update a.ts and 2 more files'
    );
    expect(fallbackCommitSubject([file('a.ts'), file('b.ts')])).toBe('Update a.ts and 1 more file');
  });

  it('falls back to Update when the statuses disagree', () => {
    expect(fallbackCommitSubject([file('a.ts', 'untracked'), file('b.ts', 'deleted')])).toBe(
      'Update a.ts and 1 more file'
    );
  });

  it('has something to say for an empty list', () => {
    expect(fallbackCommitSubject([])).toBe('Update working tree');
  });
});

describe('collectWorktreeDiff', () => {
  it('joins the patches of the changed files', async () => {
    const diff = await collectWorktreeDiff(
      [file('a.ts'), file('b.ts')],
      async (p) => `--- patch for ${p}`
    );
    expect(diff).toContain('--- patch for a.ts');
    expect(diff).toContain('--- patch for b.ts');
  });

  it('skips files whose patch cannot be read, and empty ones', async () => {
    const diff = await collectWorktreeDiff(
      [file('a.ts'), file('b.ts'), file('c.ts')],
      async (p) => {
        if (p === 'a.ts') throw new Error('gone');
        if (p === 'b.ts') return '   ';
        return 'real patch';
      }
    );
    expect(diff).toBe('real patch');
  });

  it('stays inside a size budget even for a huge change', async () => {
    const many = Array.from({ length: 40 }, (_, i) => file(`f${i}.ts`));
    const diff = await collectWorktreeDiff(many, async () => 'x'.repeat(20_000));
    expect(diff.length).toBeLessThanOrEqual(17_000);
  });
});

describe('buildCommitSubjectPrompt', () => {
  it('carries the file list, the patch and the task the agent was given', () => {
    const prompt = buildCommitSubjectPrompt({
      files: [file('src/a.ts'), file('src/b.ts', 'deleted')],
      diff: '@@ -1 +1 @@',
      task: 'make the upload retry',
    });
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('src/b.ts');
    expect(prompt).toContain('deleted');
    expect(prompt).toContain('@@ -1 +1 @@');
    expect(prompt).toContain('make the upload retry');
  });

  it('works without a task', () => {
    const prompt = buildCommitSubjectPrompt({ files: [file('a.ts')], diff: 'patch' });
    expect(prompt).toContain('a.ts');
  });
});

describe('generateCommitSubject', () => {
  function deps(overrides: Partial<Parameters<typeof generateCommitSubject>[0]> = {}) {
    return {
      task: 'was ist hier los seit 24 stunden',
      listChanges: vi.fn(async () => [file('src/lib/git/repos.ts')]),
      diffFor: vi.fn(async () => '@@ -1 +1 @@\n-a\n+b\n'),
      askLlm: vi.fn(async () => 'Cache the repo discovery walk'),
      ...overrides,
    };
  }

  it('returns what the model wrote, cleaned up', async () => {
    const input = deps({ askLlm: vi.fn(async () => '  "Cache the repo discovery walk"\n') });
    await expect(generateCommitSubject(input)).resolves.toBe('Cache the repo discovery walk');
    expect(input.askLlm).toHaveBeenCalledWith(expect.stringContaining('src/lib/git/repos.ts'));
  });

  it('never lets the original prompt become the message', async () => {
    const subject = await generateCommitSubject(deps());
    expect(subject).not.toContain('was ist hier los seit 24 stunden');
  });

  it('falls back to the file summary when the model is unreachable', async () => {
    const input = deps({
      askLlm: vi.fn(async () => {
        throw new Error('no api key configured');
      }),
    });
    await expect(generateCommitSubject(input)).resolves.toBe('Update repos.ts');
  });

  it('falls back when the model answers with nothing usable', async () => {
    const input = deps({ askLlm: vi.fn(async () => '   \n') });
    await expect(generateCommitSubject(input)).resolves.toBe('Update repos.ts');
  });

  it('does not ask the model when nothing changed', async () => {
    const input = deps({ listChanges: vi.fn(async () => []) });
    await expect(generateCommitSubject(input)).resolves.toBe('Update working tree');
    expect(input.askLlm).not.toHaveBeenCalled();
  });

  it('ignores ignored files', async () => {
    const input = deps({
      listChanges: vi.fn(async () => [file('node_modules/x', 'ignored'), file('src/a.ts')]),
    });
    await generateCommitSubject(input);
    expect(input.diffFor).toHaveBeenCalledTimes(1);
    expect(input.diffFor).toHaveBeenCalledWith('src/a.ts');
  });

  it('survives a status read that fails', async () => {
    const input = deps({
      listChanges: vi.fn(async () => {
        throw new Error('not a repo');
      }),
    });
    await expect(generateCommitSubject(input)).resolves.toBe('Update working tree');
  });
});
