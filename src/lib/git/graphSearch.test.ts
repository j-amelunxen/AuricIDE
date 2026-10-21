import { describe, expect, it } from 'vitest';
import type { GitRef, GraphCommit } from '../tauri/gitGraph';
import { matchingOids } from './graphSearch';

function commit(
  oid: string,
  summary: string,
  authorName = 'Sam Doe',
  authorEmail = 'sam@example.org'
): GraphCommit {
  return { oid, parents: [], summary, authorName, authorEmail, authorTime: 0, committerTime: 0 };
}

function ref(shorthand: string, target: string): GitRef {
  return {
    name: `refs/heads/${shorthand}`,
    shorthand,
    kind: 'local',
    target,
    upstream: null,
    ahead: null,
    behind: null,
    isCurrent: false,
  };
}

const COMMITS = [
  commit('aaaa1111', 'Fix login redirect'),
  commit('bbbb2222', 'Add graph view', 'Alex Roe', 'alex@example.org'),
  commit('cccc3333', 'Bump deps'),
];
const REFS = [ref('release/2.0', 'cccc3333')];

describe('matchingOids', () => {
  it('matches the summary, case-insensitively, in row order', () => {
    expect(matchingOids(COMMITS, REFS, 'LOGIN')).toEqual(['aaaa1111']);
    expect(matchingOids(COMMITS, REFS, 'e')).toEqual(['aaaa1111', 'bbbb2222', 'cccc3333']);
  });

  it('matches author name and email', () => {
    expect(matchingOids(COMMITS, REFS, 'alex r')).toEqual(['bbbb2222']);
    expect(matchingOids(COMMITS, REFS, 'alex@')).toEqual(['bbbb2222']);
  });

  it('matches a sha prefix of four or more hex characters only', () => {
    expect(matchingOids(COMMITS, REFS, 'bbbb')).toEqual(['bbbb2222']);
    expect(matchingOids(COMMITS, REFS, 'bbb')).toEqual([]);
    expect(matchingOids(COMMITS, REFS, 'bbbb22')).toEqual(['bbbb2222']);
  });

  it('matches the shorthand of a ref pointing at the commit', () => {
    expect(matchingOids(COMMITS, REFS, 'release')).toEqual(['cccc3333']);
  });

  it('matches nothing for an empty or blank query, or when nothing fits', () => {
    expect(matchingOids(COMMITS, REFS, '')).toEqual([]);
    expect(matchingOids(COMMITS, REFS, '   ')).toEqual([]);
    expect(matchingOids(COMMITS, REFS, 'zzzz')).toEqual([]);
  });
});
