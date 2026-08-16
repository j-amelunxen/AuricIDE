import { describe, expect, it } from 'vitest';
import { createLineBuffer, MAX_PARTIAL_LINE_BYTES } from './lineBuffer';

describe('createLineBuffer', () => {
  it('holds a line back until its newline arrives', () => {
    const buffer = createLineBuffer();
    expect(buffer.take('pnpm te')).toEqual([]);
    expect(buffer.take('st:run\n')).toEqual(['pnpm test:run']);
  });

  it('reassembles a line split across three chunks', () => {
    const buffer = createLineBuffer();
    buffer.take('pn');
    buffer.take('pm li');
    expect(buffer.take('nt\n')).toEqual(['pnpm lint']);
  });

  it('returns every line a single chunk completes', () => {
    const buffer = createLineBuffer();
    expect(buffer.take('one\ntwo\nthree\n')).toEqual(['one', 'two', 'three']);
  });

  it('treats a bare carriage return as a line break', () => {
    // Progress bars redraw with \r; for line-oriented reading that ends a line.
    const buffer = createLineBuffer();
    expect(buffer.take('first\rsecond\n')).toEqual(['first', 'second']);
  });

  it('collapses \\r\\n into one break rather than emitting a blank line', () => {
    const buffer = createLineBuffer();
    expect(buffer.take('first\r\nsecond\n')).toEqual(['first', 'second']);
  });

  it('keeps a trailing partial line for the next chunk', () => {
    const buffer = createLineBuffer();
    expect(buffer.take('done\nhalf')).toEqual(['done']);
    expect(buffer.take('-line\n')).toEqual(['half-line']);
  });

  it('caps a partial line that never terminates, keeping the newest tail', () => {
    const buffer = createLineBuffer(16);
    // 1 MB of newline-free output must not grow the buffer without bound.
    for (let i = 0; i < 100; i++) buffer.take('x'.repeat(10_000));
    buffer.take('TAIL');

    const [line] = buffer.take('\n');
    // The cap dropped the front, so the line that finally completes is the
    // newest tail rather than a megabyte of noise.
    expect(line.length).toBeLessThanOrEqual(16);
    expect(line.endsWith('TAIL')).toBe(true);
  });

  it('emits the capped remainder once a newline finally arrives', () => {
    const buffer = createLineBuffer(16);
    const lines = buffer.take(`${'x'.repeat(100)}TAIL\n`);
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThanOrEqual(104);
    expect(lines[0].endsWith('TAIL')).toBe(true);
  });

  it('defaults its cap to the documented ceiling', () => {
    expect(MAX_PARTIAL_LINE_BYTES).toBe(64 * 1024);
  });

  it('ignores an empty chunk', () => {
    const buffer = createLineBuffer();
    expect(buffer.take('')).toEqual([]);
  });
});
