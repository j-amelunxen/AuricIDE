import { describe, expect, it } from 'vitest';
import type { GitRepoRef } from '@/lib/tauri/git';
import {
  AURIC_WORKTREE_BRANCH_PREFIX,
  AURIC_WORKTREE_DIR_SUFFIX,
  auricWorktreeDir,
  isAuricWorktreeBranch,
  isAuricWorktreePath,
  needsWorktreeRepoPicker,
  slugifyAgentWorktreeName,
  worktreeIsOccupied,
  worktreeSourceRepos,
} from './agentWorktree';

function repo(
  path: string,
  relativePath: string,
  name: string,
  kind: GitRepoRef['kind']
): GitRepoRef {
  return { path, relativePath, name, kind };
}

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

describe('worktreeSourceRepos', () => {
  const api = repo('/ws/api', 'api', 'api', 'nested');
  const web = repo('/ws/web', 'web', 'web', 'submodule');
  const nested = [api, web];

  it('returns nothing when the working directory is empty', () => {
    expect(worktreeSourceRepos('', nested)).toEqual([]);
  });

  it('offers every nested repo when the working directory itself is not a git repo', () => {
    expect(worktreeSourceRepos('/ws', nested)).toEqual([api, web]);
  });

  it('tolerates a trailing slash on the working directory', () => {
    expect(worktreeSourceRepos('/ws/', nested)).toEqual([api, web]);
  });

  it('uses the working directory itself when it is a git repo, even if nested repos exist', () => {
    const root = repo('/ws', '', 'ws', 'root');
    expect(worktreeSourceRepos('/ws', [root, api, web])).toEqual([root]);
  });

  it('returns nothing when no git repo was discovered', () => {
    expect(worktreeSourceRepos('/ws', [])).toEqual([]);
  });
});

describe('needsWorktreeRepoPicker', () => {
  const api = repo('/ws/api', 'api', 'api', 'nested');
  const web = repo('/ws/web', 'web', 'web', 'nested');

  it('asks when the working directory is not a git repo but nested ones exist', () => {
    expect(needsWorktreeRepoPicker('/ws', [api, web])).toBe(true);
  });

  it('asks even for a single nested repo, so the source is visible', () => {
    expect(needsWorktreeRepoPicker('/ws', [api])).toBe(true);
  });

  it('does not ask when the working directory itself is the repo', () => {
    const root = repo('/ws', '', 'ws', 'root');
    expect(needsWorktreeRepoPicker('/ws', [root, api])).toBe(false);
  });

  it('does not ask when there is nothing to pick', () => {
    expect(needsWorktreeRepoPicker('/ws', [])).toBe(false);
    expect(needsWorktreeRepoPicker('', [api])).toBe(false);
  });
});
