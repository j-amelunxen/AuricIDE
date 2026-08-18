import { describe, expect, it } from 'vitest';
import {
  AURIC_WORKTREE_BRANCH_PREFIX,
  AURIC_WORKTREE_DIR_SUFFIX,
  auricWorktreeDir,
  isAuricWorktreeBranch,
  isAuricWorktreePath,
  slugifyAgentWorktreeName,
  worktreeIsOccupied,
} from './agentWorktree';

describe('slugifyAgentWorktreeName', () => {
  it('lowercases and turns punctuation into dashes', () => {
    expect(slugifyAgentWorktreeName('Fix login!!!')).toBe('fix-login');
  });

  it('collapses repeated separators and trims edges', () => {
    expect(slugifyAgentWorktreeName('  --Hello   World--  ')).toBe('hello-world');
  });

  it('falls back to agent when nothing usable remains', () => {
    expect(slugifyAgentWorktreeName('***')).toBe('agent');
    expect(slugifyAgentWorktreeName('')).toBe('agent');
  });

  it('caps the slug so branch names stay short', () => {
    const slug = slugifyAgentWorktreeName('a'.repeat(80));
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug).toMatch(/^a+$/);
  });
});

describe('auricWorktreeDir', () => {
  it('places worktrees as a sibling folder next to the repo', () => {
    expect(auricWorktreeDir('/Users/dev/AuricIDE')).toBe(
      `/Users/dev/AuricIDE${AURIC_WORKTREE_DIR_SUFFIX}`
    );
  });

  it('strips a trailing slash on the repo path', () => {
    expect(auricWorktreeDir('/tmp/project/')).toBe(`/tmp/project${AURIC_WORKTREE_DIR_SUFFIX}`);
  });
});

describe('isAuricWorktreePath', () => {
  it('recognises a checkout under the sibling worktree folder', () => {
    expect(isAuricWorktreePath(`/tmp/project${AURIC_WORKTREE_DIR_SUFFIX}/fix-login-ab12`)).toBe(
      true
    );
  });

  it('rejects the main checkout', () => {
    expect(isAuricWorktreePath('/tmp/project')).toBe(false);
  });
});

describe('isAuricWorktreeBranch', () => {
  it('only accepts the reserved prefix', () => {
    expect(isAuricWorktreeBranch(`${AURIC_WORKTREE_BRANCH_PREFIX}fix-login-ab12`)).toBe(true);
    expect(isAuricWorktreeBranch('feature/login')).toBe(false);
    expect(isAuricWorktreeBranch(null)).toBe(false);
  });
});

describe('worktreeIsOccupied', () => {
  it('is occupied only while a running agent uses that cwd', () => {
    const path = '/tmp/project.auric-wt/fix';
    expect(worktreeIsOccupied(path, [{ status: 'running', repoPath: path }])).toBe(true);
    expect(worktreeIsOccupied(path, [{ status: 'idle', repoPath: path }])).toBe(false);
    expect(worktreeIsOccupied(path, [{ status: 'running', repoPath: '/tmp/other' }])).toBe(false);
  });
});
