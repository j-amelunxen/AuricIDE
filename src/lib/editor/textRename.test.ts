import { describe, expect, it } from 'vitest';
import { countWordMatches, renameWord, wordAt, wordMatchRanges } from './textRename';

describe('renameWord', () => {
  it('replaces whole words only', () => {
    const src = 'const user = getUser(user);\nuserName = user;';
    expect(renameWord(src, 'user', 'account')).toBe(
      'const account = getUser(account);\nuserName = account;'
    );
  });

  it('treats $ and _ as part of an identifier and escapes regex characters', () => {
    expect(renameWord('$a $ab a_b a', 'a', 'z')).toBe('$a $ab a_b z');
    expect(renameWord('x.y x_y', 'x.y', 'q')).toBe('q x_y');
  });

  it('refuses a target that is not an identifier', () => {
    expect(() => renameWord('a', 'a', 'not valid')).toThrow();
    expect(() => renameWord('a', 'a', '')).toThrow();
  });
});

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
