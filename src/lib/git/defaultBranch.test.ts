import { describe, expect, it } from 'vitest';
import { resolveDefaultBranchName } from './defaultBranch';

describe('resolveDefaultBranchName', () => {
  it('picks main when that is the only default-shaped local branch', () => {
    expect(resolveDefaultBranchName({ local: ['main', 'auric/fix'] })).toBe('main');
  });

  it('picks master when the repo never moved off it', () => {
    expect(resolveDefaultBranchName({ local: ['master', 'feature/x'] })).toBe('master');
  });

  it('prefers main when both exist and origin/HEAD is silent', () => {
    expect(resolveDefaultBranchName({ local: ['master', 'main'] })).toBe('main');
  });

  it('follows origin/HEAD when it names master or main and that branch exists', () => {
    expect(resolveDefaultBranchName({ local: ['main', 'master'], originHead: 'master' })).toBe(
      'master'
    );
    expect(resolveDefaultBranchName({ local: ['main', 'master'], originHead: 'main' })).toBe(
      'main'
    );
  });

  it('ignores origin/HEAD when it names something else', () => {
    expect(resolveDefaultBranchName({ local: ['main', 'develop'], originHead: 'develop' })).toBe(
      'main'
    );
  });

  it('returns null when neither main nor master exists', () => {
    expect(resolveDefaultBranchName({ local: ['develop', 'trunk'] })).toBeNull();
  });
});
