import { describe, expect, it } from 'vitest';
import { GIT_ERROR_CODES } from '@/lib/tauri/gitGraph';

const CODES = [
  ...GIT_ERROR_CODES.filter((c) => c !== 'already_applied'),
  'unknown',
  'busy',
] as const;
import { refusalTitle, refusalToastText } from './graphErrors';

describe('refusalTitle', () => {
  it('has a title for every contract code, plus unknown and busy', () => {
    for (const code of CODES) {
      expect(refusalTitle(code)).toMatch(/\S/);
    }
  });
  it('never uses an em dash', () => {
    for (const code of CODES) {
      expect(refusalTitle(code)).not.toContain('—');
    }
  });
});

describe('not_found', () => {
  it('says what could not be found', () => {
    expect(refusalTitle('not_found')).toBe('The branch, tag or commit no longer exists');
  });
});

describe('refusalToastText', () => {
  it('joins the mapped title and the sentence', () => {
    expect(refusalToastText('dirty_worktree', 'Commit or stash your changes first.')).toBe(
      'You have uncommitted changes. Commit or stash your changes first.'
    );
  });
});
