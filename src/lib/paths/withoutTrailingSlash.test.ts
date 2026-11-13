import { describe, expect, it } from 'vitest';
import { withoutTrailingSlash } from './withoutTrailingSlash';

describe('withoutTrailingSlash', () => {
  it.each([
    ['/a/b/', '/a/b'],
    ['/a/b//', '/a/b'],
    ['/a/b', '/a/b'],
    ['a/', 'a'],
    ['/', '/'],
    ['//', '/'],
    ['', ''],
  ])('%j -> %j', (input, expected) => expect(withoutTrailingSlash(input)).toBe(expected));
});
