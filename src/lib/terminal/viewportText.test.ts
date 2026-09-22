import { describe, expect, it } from 'vitest';
import { visibleTerminalText, type ViewportTerminal } from './viewportText';

function terminal(lines: Array<string | undefined>, rows: number, viewportY = 0): ViewportTerminal {
  return {
    rows,
    buffer: {
      active: {
        viewportY,
        getLine(index) {
          const text = lines[index];
          if (text === undefined) return undefined;
          return {
            translateToString: (trimRight) => (trimRight ? text.replace(/\s+$/, '') : text),
          };
        },
      },
    },
  };
}

describe('visibleTerminalText', () => {
  it('reads only the rows on screen, not the scrollback above them', () => {
    const term = terminal(['old', 'also old', 'on screen', 'still on screen', 'below'], 2, 2);
    expect(visibleTerminalText(term)).toBe('on screen\nstill on screen');
  });

  it('drops blank rows at the edges and keeps a blank row between text', () => {
    const term = terminal(['', '  ', 'hello', '', 'world', '', ''], 7);
    expect(visibleTerminalText(term)).toBe('hello\n\nworld');
  });

  it('is empty when the viewport has no text', () => {
    expect(visibleTerminalText(terminal(['', '   '], 2))).toBe('');
  });

  it('treats a missing line as blank', () => {
    const term = terminal(['kept', undefined, 'also'], 3);
    expect(visibleTerminalText(term)).toBe('kept\n\nalso');
  });

  it('calls getLine as a method of the buffer', () => {
    const term = terminal(['kept'], 1);
    const buffer = term.buffer.active;
    const original = buffer.getLine.bind(buffer);
    buffer.getLine = function getLine(index) {
      if (this !== buffer) throw new Error('getLine lost its buffer');
      return original(index);
    };
    expect(visibleTerminalText(term)).toBe('kept');
  });
});
