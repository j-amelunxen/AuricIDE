import { describe, expect, it } from 'vitest';
import { wordDiff } from './wordDiff';

describe('wordDiff', () => {
  it('marks nothing changed when lines are identical', () => {
    const { left, right } = wordDiff('hello world', 'hello world');
    expect(left.every((s) => !s.changed)).toBe(true);
    expect(right.every((s) => !s.changed)).toBe(true);
    expect(left.map((s) => s.text).join('')).toBe('hello world');
    expect(right.map((s) => s.text).join('')).toBe('hello world');
  });

  it('marks a swapped word as changed and keeps the rest', () => {
    const { left, right } = wordDiff('the cat sat', 'the dog sat');
    expect(left).toEqual([
      { text: 'the', changed: false },
      { text: ' ', changed: false },
      { text: 'cat', changed: true },
      { text: ' ', changed: false },
      { text: 'sat', changed: false },
    ]);
    expect(right).toEqual([
      { text: 'the', changed: false },
      { text: ' ', changed: false },
      { text: 'dog', changed: true },
      { text: ' ', changed: false },
      { text: 'sat', changed: false },
    ]);
  });

  it('keeps punctuation as its own tokens', () => {
    const { left, right } = wordDiff('hello, world', 'hello. world');
    expect(left.map((s) => s.text)).toEqual(['hello', ',', ' ', 'world']);
    expect(right.map((s) => s.text)).toEqual(['hello', '.', ' ', 'world']);
    expect(left.find((s) => s.text === ',')?.changed).toBe(true);
    expect(right.find((s) => s.text === '.')?.changed).toBe(true);
    expect(left.find((s) => s.text === 'hello')?.changed).toBe(false);
    expect(left.find((s) => s.text === 'world')?.changed).toBe(false);
    expect(right.find((s) => s.text === 'hello')?.changed).toBe(false);
    expect(right.find((s) => s.text === 'world')?.changed).toBe(false);
  });

  it('treats empty vs non-empty as fully changed', () => {
    const emptyToText = wordDiff('', 'hello');
    expect(emptyToText.left).toEqual([]);
    expect(emptyToText.right).toEqual([{ text: 'hello', changed: true }]);

    const textToEmpty = wordDiff('hello', '');
    expect(textToEmpty.left).toEqual([{ text: 'hello', changed: true }]);
    expect(textToEmpty.right).toEqual([]);
  });

  it('treats whitespace-only token differences as changed', () => {
    const { left, right } = wordDiff('foo  bar', 'foo bar');
    expect(left).toEqual([
      { text: 'foo', changed: false },
      { text: '  ', changed: true },
      { text: 'bar', changed: false },
    ]);
    expect(right).toEqual([
      { text: 'foo', changed: false },
      { text: ' ', changed: true },
      { text: 'bar', changed: false },
    ]);
  });
});
