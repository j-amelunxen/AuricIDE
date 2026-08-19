import { describe, expect, it } from 'vitest';
import fixtures from './ignoredRepos.fixtures.json';
import {
  addIgnoredRepo,
  isIgnoredRepoPath,
  parseIgnoredRepos,
  relativePathForIgnore,
  removeIgnoredRepo,
  serializeIgnoredRepos,
} from './ignoredRepos';

describe('ignored repos — shared contract', () => {
  describe('parseIgnoredRepos', () => {
    for (const testCase of fixtures.parse) {
      it(testCase.name, () => {
        expect(parseIgnoredRepos(testCase.raw)).toEqual(testCase.expected);
      });
    }
  });

  describe('isIgnoredRepoPath', () => {
    for (const testCase of fixtures.match) {
      it(testCase.name, () => {
        expect(isIgnoredRepoPath(testCase.path, testCase.ignored)).toBe(testCase.matches);
      });
    }
  });
});

describe('ignored repos — TypeScript surface', () => {
  it('round-trips a list through serialize and parse', () => {
    const stored = serializeIgnoredRepos(['web', 'vendor/lib']);
    expect(parseIgnoredRepos(stored)).toEqual(['vendor/lib', 'web']);
  });

  it('adds a path after normalising it', () => {
    expect(addIgnoredRepo(['api'], './vendor/')).toEqual(['api', 'vendor']);
  });

  it('refuses to add the project root', () => {
    expect(addIgnoredRepo(['api'], '')).toEqual(['api']);
    expect(addIgnoredRepo(['api'], '.')).toEqual(['api']);
  });

  it('does not duplicate an already ignored path', () => {
    expect(addIgnoredRepo(['vendor'], 'vendor/')).toEqual(['vendor']);
  });

  it('removes a path after normalising it', () => {
    expect(removeIgnoredRepo(['api', 'vendor'], 'vendor/')).toEqual(['api']);
  });

  it('turns an absolute folder under the project into a relative ignore entry', () => {
    expect(relativePathForIgnore('/work/meta', '/work/meta/vendor/lib')).toBe('vendor/lib');
  });

  it('returns null for the project root itself', () => {
    expect(relativePathForIgnore('/work/meta', '/work/meta')).toBeNull();
  });

  it('returns null for a path outside the project', () => {
    expect(relativePathForIgnore('/work/meta', '/elsewhere/lib')).toBeNull();
  });
});
