import { describe, expect, it } from 'vitest';
import {
  ENTITY_REGEX,
  STRUCTURE_REGEX,
  PROMPT_DIRECTIVE_REGEX,
  PROMPT_CONTEXT_REGEX,
  PROMPT_CONSTRAINT_REGEX,
} from './patterns';

describe('ENTITY_REGEX', () => {
  function matchAll(text: string): string[] {
    ENTITY_REGEX.lastIndex = 0;
    const matches: string[] = [];
    let m;
    while ((m = ENTITY_REGEX.exec(text)) !== null) {
      matches.push(m[0]);
    }
    return matches;
  }

  it('matches PascalCase identifiers', () => {
    expect(matchAll('CustomerSupportBot is running')).toEqual(['CustomerSupportBot']);
  });

  it('matches two-part PascalCase', () => {
    expect(matchAll('Use DataStore')).toEqual(['DataStore']);
  });

  it('matches multiple PascalCase in one string', () => {
    expect(matchAll('IntentClassifier calls DataPipeline')).toEqual([
      'IntentClassifier',
      'DataPipeline',
    ]);
  });

  it('matches UPPER_CASE identifiers', () => {
    expect(matchAll('Open the README file')).toEqual(['README']);
  });

  it('matches UPPER_CASE with underscores and numbers', () => {
    expect(matchAll('Use MAX_RETRY_COUNT and API_KEY_V2')).toEqual([
      'MAX_RETRY_COUNT',
      'API_KEY_V2',
    ]);
  });

  it('does NOT match single capitalized words like "The"', () => {
    expect(matchAll('The Monday Report')).toEqual([]);
  });

  it('does NOT match all lowercase', () => {
    expect(matchAll('hello world')).toEqual([]);
  });

  it('does NOT match single uppercase letter', () => {
    expect(matchAll('A B C')).toEqual([]);
  });
});

describe('STRUCTURE_REGEX', () => {
  function matchAll(text: string): string[] {
    STRUCTURE_REGEX.lastIndex = 0;
    const matches: string[] = [];
    let m;
    while ((m = STRUCTURE_REGEX.exec(text)) !== null) {
      matches.push(m[0]);
    }
    return matches;
  }

  it('matches TODO', () => {
    expect(matchAll('TODO fix this')).toEqual(['TODO']);
  });

  it('matches FIXME', () => {
    expect(matchAll('FIXME broken logic')).toEqual(['FIXME']);
  });

  it('does not match lowercase', () => {
    expect(matchAll('todo fixme')).toEqual([]);
  });
});

describe('PROMPT_DIRECTIVE_REGEX', () => {
  it('matches Task: lines', () => {
    PROMPT_DIRECTIVE_REGEX.lastIndex = 0;
    const match = PROMPT_DIRECTIVE_REGEX.exec('Task: Do something');
    expect(match).not.toBeNull();
  });
});

describe('PROMPT_CONTEXT_REGEX', () => {
  it('matches Context: lines', () => {
    PROMPT_CONTEXT_REGEX.lastIndex = 0;
    const match = PROMPT_CONTEXT_REGEX.exec('Context: Some background');
    expect(match).not.toBeNull();
  });
});

describe('PROMPT_CONSTRAINT_REGEX', () => {
  it('matches Constraint: lines', () => {
    PROMPT_CONSTRAINT_REGEX.lastIndex = 0;
    const match = PROMPT_CONSTRAINT_REGEX.exec('Constraint: Must be fast');
    expect(match).not.toBeNull();
  });
});
