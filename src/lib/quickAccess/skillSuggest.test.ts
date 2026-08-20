import { describe, expect, it } from 'vitest';
import type { ProjectSkill } from '../tauri/projectSkills';
import {
  suggestSkills,
  SKILL_SUGGESTION_LIMIT,
  skillTokenAtCursor,
  applySkillInvocation,
} from './skillSuggest';

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

describe('skillTokenAtCursor', () => {
  it('returns nothing in an empty field', () => {
    expect(skillTokenAtCursor('', 0)).toBeNull();
  });

  it('returns nothing while writing a sentence', () => {
    expect(skillTokenAtCursor('fix the tests', 13)).toBeNull();
  });

  it('treats a lone slash as a query', () => {
    expect(skillTokenAtCursor('/', 1)).toEqual({
      start: 0,
      end: 1,
      query: '/',
      tokenEnd: 1,
    });
  });

  it('captures the slash-token the cursor is in', () => {
    expect(skillTokenAtCursor('/comm', 5)).toEqual({
      start: 0,
      end: 5,
      query: '/comm',
      tokenEnd: 5,
    });
  });

  it('finds a slash-token after other words', () => {
    const text = 'please /cha';
    expect(skillTokenAtCursor(text, text.length)).toEqual({
      start: 7,
      end: 11,
      query: '/cha',
      tokenEnd: 11,
    });
  });

  it('finds a slash-token at the start of a new line', () => {
    const text = 'intro\n/tdd';
    expect(skillTokenAtCursor(text, text.length)).toEqual({
      start: 6,
      end: 10,
      query: '/tdd',
      tokenEnd: 10,
    });
  });

  it('keeps the whole token as the replacement range when the cursor is in the middle', () => {
    const text = '/changelog now';
    expect(skillTokenAtCursor(text, 4)).toEqual({
      start: 0,
      end: 4,
      query: '/cha',
      tokenEnd: 10,
    });
  });

  it('returns nothing once a space has closed the token', () => {
    expect(skillTokenAtCursor('/changelog now', 14)).toBeNull();
  });

  it('does not treat a slash inside a word as a skill', () => {
    expect(skillTokenAtCursor('http://github.com', 17)).toBeNull();
  });
});

describe('applySkillInvocation', () => {
  it('replaces a partial token and adds a trailing space', () => {
    expect(applySkillInvocation('/comm', skillTokenAtCursor('/comm', 5)!, '/commit')).toEqual({
      text: '/commit ',
      cursor: 8,
    });
  });

  it('keeps the rest of the prompt around the token', () => {
    const text = 'please /cha extra';
    const token = skillTokenAtCursor(text, 11)!;
    expect(applySkillInvocation(text, token, '/changelog')).toEqual({
      text: 'please /changelog extra',
      cursor: 18, // after the inserted invocation and its trailing space
    });
  });

  it('does not add a second space when one already follows the token', () => {
    const text = '/cha extra';
    const token = skillTokenAtCursor(text, 4)!;
    expect(applySkillInvocation(text, token, '/changelog').text).toBe('/changelog extra');
  });
});
