import { describe, expect, it } from 'vitest';
import {
  appendStreamLines,
  createStreamCapture,
  isReadableLine,
  MAX_STREAM_LINES,
  type StreamLine,
} from './streamCapture';

const texts = (lines: StreamLine[]) => lines.map((l) => l.text);

describe('isReadableLine', () => {
  it('keeps anything with a letter or a digit', () => {
    expect(isReadableLine('Running pnpm test')).toBe(true);
    expect(isReadableLine('  197 records')).toBe(true);
    expect(isReadableLine('│ Edited x.ts │')).toBe(true);
  });

  it('drops redraw chrome that carries no text', () => {
    for (const line of ['', '   ', '────────────', '╭──────╮', '│      │', '⠋', '  ·  ']) {
      expect(isReadableLine(line)).toBe(false);
    }
  });
});

describe('createStreamCapture', () => {
  it('emits whole lines with a timestamp and a monotonic sequence', () => {
    const capture = createStreamCapture();
    const lines = capture.push('first\nsecond\n', 1000);

    expect(texts(lines)).toEqual(['first', 'second']);
    expect(lines.map((l) => l.at)).toEqual([1000, 1000]);
    expect(lines.map((l) => l.seq)).toEqual([0, 1]);
  });

  it('keeps the sequence rising across chunks', () => {
    const capture = createStreamCapture();
    capture.push('one\n', 0);
    const [line] = capture.push('two\n', 1);
    expect(line.seq).toBe(1);
  });

  it('holds a half-delivered line until it completes', () => {
    const capture = createStreamCapture();
    expect(capture.push('pnpm te', 0)).toEqual([]);
    expect(texts(capture.push('st:run\n', 1))).toEqual(['pnpm test:run']);
  });

  it('strips ANSI colour codes', () => {
    const capture = createStreamCapture();
    const lines = capture.push('[32mgreen text[0m\n', 0);
    expect(texts(lines)).toEqual(['green text']);
  });

  it('drops lines that are only box drawing or whitespace', () => {
    const capture = createStreamCapture();
    const lines = capture.push('╭────────╮\n│  Real  │\n╰────────╯\n   \n', 0);
    expect(texts(lines)).toEqual(['│  Real  │']);
  });

  it('collapses a line that redraws itself unchanged', () => {
    // A spinner or status row repeats many times a second; unfiltered it
    // would bury everything else in the merged feed.
    const capture = createStreamCapture();
    const lines = capture.push('Thinking...\nThinking...\nThinking...\nDone\n', 0);
    expect(texts(lines)).toEqual(['Thinking...', 'Done']);
  });

  it('collapses repeats across chunk boundaries too', () => {
    const capture = createStreamCapture();
    expect(texts(capture.push('Working\n', 0))).toEqual(['Working']);
    expect(texts(capture.push('Working\n', 1))).toEqual([]);
  });

  it('shows a line again when something else came between', () => {
    // Only *consecutive* repeats collapse — a status that genuinely recurs
    // after other output is real information.
    const capture = createStreamCapture();
    const lines = capture.push('Working\nSaved x.ts\nWorking\n', 0);
    expect(texts(lines)).toEqual(['Working', 'Saved x.ts', 'Working']);
  });

  it('trims trailing padding but keeps leading indentation', () => {
    // Indentation carries structure in agent TUIs; trailing spaces do not.
    const capture = createStreamCapture();
    const lines = capture.push('    indented   \n', 0);
    expect(texts(lines)).toEqual(['    indented']);
  });
});

describe('appendStreamLines', () => {
  const line = (seq: number): StreamLine => ({ text: `line ${seq}`, at: seq, seq });

  it('appends in order', () => {
    expect(texts(appendStreamLines([line(0)], [line(1), line(2)]))).toEqual([
      'line 0',
      'line 1',
      'line 2',
    ]);
  });

  it('returns the original array when nothing came in', () => {
    const existing = [line(0)];
    expect(appendStreamLines(existing, [])).toBe(existing);
  });

  it('drops the oldest lines past the cap', () => {
    const existing = Array.from({ length: MAX_STREAM_LINES }, (_, i) => line(i));
    const result = appendStreamLines(existing, [line(MAX_STREAM_LINES)]);

    expect(result).toHaveLength(MAX_STREAM_LINES);
    expect(result[0].seq).toBe(1);
    expect(result[result.length - 1].seq).toBe(MAX_STREAM_LINES);
  });

  it('does not mutate the array it was given', () => {
    const existing = [line(0)];
    appendStreamLines(existing, [line(1)]);
    expect(existing).toHaveLength(1);
  });
});
