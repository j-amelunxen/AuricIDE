import { describe, expect, it } from 'vitest';
import { isRedrawNoise, stripLeadingDecoration } from './terminalChrome';

describe('isRedrawNoise', () => {
  it.each(['esc to interrupt', '? for shortcuts', 'ctrl+t to show todos', 'press tab to cycle'])(
    'treats the CLI hint "%s" as noise',
    (line) => expect(isRedrawNoise(line)).toBe(true)
  );

  it('sees a hint behind a spinner glyph', () => {
    expect(isRedrawNoise('✻ esc to interrupt')).toBe(true);
  });

  it('treats lines without a letter as noise', () => {
    expect(isRedrawNoise('███ 62%')).toBe(true);
    expect(isRedrawNoise('────')).toBe(true);
  });

  it('keeps real output', () => {
    expect(isRedrawNoise('⏺ Reading src/main.ts')).toBe(false);
    expect(isRedrawNoise('Pressure test passed')).toBe(false);
  });
});

describe('stripLeadingDecoration', () => {
  it('removes the glyph a spinner rotates, keeping quotes and brackets', () => {
    expect(stripLeadingDecoration('⠋ Thinking')).toBe('Thinking');
    expect(stripLeadingDecoration('"quoted" text')).toBe('"quoted" text');
  });
});
