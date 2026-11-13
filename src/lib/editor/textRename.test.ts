import { describe, expect, it } from 'vitest';
import { countWordMatches, wordAt, wordMatchRanges } from './textRename';

describe('countWordMatches', () => {
  it('counts whole-word hits', () => {
    expect(countWordMatches('a ab a', 'a')).toBe(2);
  });
});

describe('wordAt', () => {
  it('finds the identifier around a position', () => {
    expect(wordAt('let fooBar = 1', 6)).toBe('fooBar');
    expect(wordAt('let fooBar = 1', 3)).toBe('let');
    expect(wordAt('a  b', 2)).toBeNull();
  });
});

describe('wordMatchRanges', () => {
  it('returns offsets of whole-word hits only', () => {
    expect(wordMatchRanges('a ab a', 'a')).toEqual([
      { from: 0, to: 1 },
      { from: 5, to: 6 },
    ]);
  });
});
