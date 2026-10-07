import { describe, expect, it } from 'vitest';
import { splitLinks } from './linkify';

const links = (text: string) =>
  splitLinks(text)
    .filter((p) => p.type === 'link')
    .map((p) => p.value);

describe('splitLinks', () => {
  it('returns no parts for an empty string', () => {
    expect(splitLinks('')).toEqual([]);
  });

  it('keeps text without a URL as one text part', () => {
    expect(splitLinks('nothing to see')).toEqual([{ type: 'text', value: 'nothing to see' }]);
  });

  it('finds a URL in the middle of a sentence', () => {
    expect(splitLinks('See https://example.com/browse/ABC-1 for details')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://example.com/browse/ABC-1' },
      { type: 'text', value: ' for details' },
    ]);
  });

  it('leaves trailing punctuation out of the link', () => {
    expect(links('Go to https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(links('(see https://example.com/a)')).toEqual(['https://example.com/a']);
    expect(links('https://example.com/a, then https://example.com/b!')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('stops at an em dash and keeps the rest as text', () => {
    expect(splitLinks('https://example.com/x — note')).toEqual([
      { type: 'link', value: 'https://example.com/x' },
      { type: 'text', value: ' — note' },
    ]);
  });

  it('keeps newlines in the text parts', () => {
    expect(splitLinks('a\nhttps://example.com/p\nb')).toEqual([
      { type: 'text', value: 'a\n' },
      { type: 'link', value: 'https://example.com/p' },
      { type: 'text', value: '\nb' },
    ]);
  });

  it('keeps query strings and fragments', () => {
    expect(links('https://example.com/a?b=1&c=2#top')).toEqual([
      'https://example.com/a?b=1&c=2#top',
    ]);
  });

  it('never turns other schemes into links', () => {
    expect(links('http://example.com')).toEqual([]);
    expect(links('javascript:alert(1) file:///etc/passwd data:text/html,x')).toEqual([]);
  });
});
