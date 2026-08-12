import { describe, expect, it } from 'vitest';
import type { ProjectSkill } from '../tauri/projectSkills';
import { suggestSkills, SKILL_SUGGESTION_LIMIT } from './skillSuggest';

function skill(overrides: Partial<ProjectSkill> & { invocation: string }): ProjectSkill {
  return {
    name: overrides.invocation.replace(/^\//, ''),
    description: null,
    source: 'skill',
    scope: 'project',
    path: `/repo/.claude/skills/${overrides.invocation.replace(/^\//, '')}/SKILL.md`,
    sourceId: 'claude',
    ...overrides,
  };
}

const CATALOGUE: ProjectSkill[] = [
  skill({ invocation: '/changelog', name: 'Changelog' }),
  skill({ invocation: '/commit', name: 'Commit' }),
  skill({ invocation: '/code-review', name: 'Code Review' }),
  skill({ invocation: '/research', name: 'Research', scope: 'user' }),
  skill({ invocation: '/frontend:component', name: 'Component', scope: 'user' }),
];

describe('suggestSkills', () => {
  it('offers the whole catalogue when nothing has been typed', () => {
    expect(suggestSkills('', CATALOGUE).map((s) => s.invocation)).toEqual([
      '/changelog',
      '/commit',
      '/code-review',
      '/research',
      '/frontend:component',
    ]);
  });

  it('treats a lone slash as an empty query, so typing "/" opens the list', () => {
    expect(suggestSkills('/', CATALOGUE)).toHaveLength(CATALOGUE.length);
  });

  it('puts project skills before the user ones when the query is empty', () => {
    const mixed = [skill({ invocation: '/user-one', scope: 'user' }), ...CATALOGUE];
    const scopes = suggestSkills('', mixed).map((s) => s.scope);
    expect(scopes.indexOf('user')).toBeGreaterThan(scopes.lastIndexOf('project'));
  });

  it('matches on the invocation, with or without the leading slash', () => {
    expect(suggestSkills('commit', CATALOGUE)[0].invocation).toBe('/commit');
    expect(suggestSkills('/commit', CATALOGUE)[0].invocation).toBe('/commit');
  });

  it('matches on the human name too', () => {
    expect(suggestSkills('Code Rev', CATALOGUE)[0].invocation).toBe('/code-review');
  });

  it('ignores case', () => {
    expect(suggestSkills('CHANGEL', CATALOGUE)[0].invocation).toBe('/changelog');
  });

  it('tolerates gaps, so "frcomp" still finds a namespaced skill', () => {
    expect(suggestSkills('frcomp', CATALOGUE)[0].invocation).toBe('/frontend:component');
  });

  it('returns nothing when the query matches nothing', () => {
    expect(suggestSkills('zzzzz', CATALOGUE)).toEqual([]);
  });

  it('never returns the same skill twice, even when name and invocation both match', () => {
    const results = suggestSkills('commit', CATALOGUE);
    expect(new Set(results.map((s) => s.path)).size).toBe(results.length);
  });

  it('caps the list so the popup stays scannable', () => {
    const many = Array.from({ length: 50 }, (_, i) => skill({ invocation: `/task-${i}` }));
    expect(suggestSkills('task', many)).toHaveLength(SKILL_SUGGESTION_LIMIT);
    expect(suggestSkills('', many)).toHaveLength(SKILL_SUGGESTION_LIMIT);
  });

  it('survives an empty catalogue', () => {
    expect(suggestSkills('anything', [])).toEqual([]);
  });
});
