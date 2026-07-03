import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi';

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m plain')).toBe('red plain');
  });

  it('removes cursor movement and erase sequences', () => {
    expect(stripAnsi('\x1b[2K\x1b[1Aline')).toBe('line');
  });

  it('removes OSC sequences (terminal title)', () => {
    expect(stripAnsi('\x1b]0;my title\x07text')).toBe('text');
  });

  it('removes carriage returns and other control chars but keeps newlines and tabs', () => {
    expect(stripAnsi('a\rb\nc\td')).toBe('ab\nc\td');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});
