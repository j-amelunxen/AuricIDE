import { describe, expect, it } from 'vitest';
import { ALL_EMOJI, EMOJI_GROUPS, emojiLabel, looksLikeEmoji, searchEmoji } from './emoji';
import { firstGrapheme } from './icon';

describe('emoji palette', () => {
  it('offers every entry exactly once', () => {
    const chars = ALL_EMOJI.map((entry) => entry.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('gives every entry at least one keyword to search by', () => {
    expect(ALL_EMOJI.filter((entry) => entry.keywords.length === 0)).toEqual([]);
  });

  // Each cell renders one character; a multi-grapheme entry would be stored
  // whole and then truncated at render, so the picker would lie.
  it('holds exactly one grapheme per entry', () => {
    const multi = ALL_EMOJI.filter((entry) => firstGrapheme(entry.char) !== entry.char);
    expect(multi).toEqual([]);
  });

  it('names every group', () => {
    expect(EMOJI_GROUPS.every((group) => group.name.length > 0)).toBe(true);
  });
});

describe('searchEmoji', () => {
  it('returns everything for an empty query', () => {
    expect(searchEmoji('   ')).toHaveLength(ALL_EMOJI.length);
  });

  it('matches on a keyword', () => {
    expect(searchEmoji('rocket').map((entry) => entry.char)).toContain('🚀');
  });

  it('matches on part of a keyword', () => {
    expect(searchEmoji('data').map((entry) => entry.char)).toContain('📊');
  });

  it('ignores case', () => {
    expect(searchEmoji('ROCKET').map((entry) => entry.char)).toContain('🚀');
  });

  it('finds an entry by the character itself', () => {
    expect(searchEmoji('🚀').map((entry) => entry.char)).toContain('🚀');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchEmoji('zzzznotathing')).toEqual([]);
  });
});

describe('looksLikeEmoji', () => {
  it('recognises a pasted emoji', () => {
    expect(looksLikeEmoji('🦕')).toBe(true);
  });

  it('recognises a ZWJ sequence', () => {
    expect(looksLikeEmoji('👩‍💻')).toBe(true);
  });

  it('does not mistake a search word for one', () => {
    expect(looksLikeEmoji('rocket')).toBe(false);
  });

  it('does not mistake an empty query for one', () => {
    expect(looksLikeEmoji('   ')).toBe(false);
  });
});

describe('emojiLabel', () => {
  it('uses the first keyword as the name', () => {
    expect(emojiLabel({ char: '🚀', keywords: ['rocket', 'launch'] })).toBe('rocket');
  });

  it('falls back to the character when there is no keyword', () => {
    expect(emojiLabel({ char: '🚀', keywords: [] })).toBe('🚀');
  });
});
