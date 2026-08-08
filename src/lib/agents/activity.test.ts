import { describe, expect, it } from 'vitest';
import { ACTIVITY_MAX_CHARS, deriveAgentActivity } from './activity';

/** Escape byte that starts every ANSI sequence, spelled out to stay readable. */
const ESCAPE = String.fromCharCode(27);

describe('deriveAgentActivity', () => {
  it('reports the newest meaningful line', () => {
    expect(deriveAgentActivity(['Reading files\n', 'Editing setup.ts\n'])).toBe('Editing setup.ts');
  });

  it('works across a chunk boundary that splits a line', () => {
    // PTY chunks are byte batches, not lines — the last line often arrives split.
    expect(deriveAgentActivity(['Running tes', 'ts for the parser\n'])).toBe(
      'Running tests for the parser'
    );
  });

  it('prefers a complete last line over a half-typed one', () => {
    expect(deriveAgentActivity(['Editing setup.ts\nRunni'])).toBe('Runni');
  });

  it('ignores ANSI colour and cursor escapes', () => {
    const coloured = `${ESCAPE}[32mEditing ${ESCAPE}[1msetup.ts${ESCAPE}[0m\n`;
    expect(deriveAgentActivity([coloured])).toBe('Editing setup.ts');
  });

  it('skips blank output', () => {
    expect(deriveAgentActivity(['Editing setup.ts\n', '\n', '   \n'])).toBe('Editing setup.ts');
  });

  it('skips terminal chrome that carries no words', () => {
    // Box borders and spinner frames redraw constantly and say nothing.
    expect(deriveAgentActivity(['Editing setup.ts\n', '╭──────────────╮\n', '│  │\n'])).toBe(
      'Editing setup.ts'
    );
  });

  it('skips the CLI hint line that redraws on every frame', () => {
    expect(deriveAgentActivity(['Editing setup.ts\n', 'esc to interrupt\n'])).toBe(
      'Editing setup.ts'
    );
  });

  it('drops a leading marker glyph but keeps the content', () => {
    expect(deriveAgentActivity(['⏺ Read(src/lib/setup.ts)\n'])).toBe('Read(src/lib/setup.ts)');
  });

  it('collapses runs of whitespace from padded terminal output', () => {
    expect(deriveAgentActivity(['Editing      setup.ts\n'])).toBe('Editing setup.ts');
  });

  it('honours a carriage return as a line break', () => {
    // Progress output overwrites in place with \r rather than \n.
    expect(deriveAgentActivity(['step 1\rstep 2\rstep 3'])).toBe('step 3');
  });

  it('truncates a very long line instead of stretching the card', () => {
    const result = deriveAgentActivity([`${'x'.repeat(400)}\n`]);
    expect(result).toHaveLength(ACTIVITY_MAX_CHARS + 1);
    expect(result?.endsWith('…')).toBe(true);
  });

  it('returns null when there is nothing to report', () => {
    expect(deriveAgentActivity([])).toBeNull();
    expect(deriveAgentActivity(['\n', '  ', '─────'])).toBeNull();
  });

  it('only scans the tail of a long buffer', () => {
    // A full retained buffer can be megabytes — deriving over all of it on
    // every update would cost more than the feature is worth.
    const chunks = Array.from({ length: 5_000 }, (_, i) => `line ${i}\n`);
    expect(deriveAgentActivity(chunks)).toBe('line 4999');
  });
});
