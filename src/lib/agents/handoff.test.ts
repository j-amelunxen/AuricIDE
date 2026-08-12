import { describe, expect, it } from 'vitest';
import { composeStepTask, deriveHandoffContext, HANDOFF_MAX_CHARS } from './handoff';

describe('deriveHandoffContext', () => {
  it('says nothing rather than something empty when there was no output', () => {
    expect(deriveHandoffContext([])).toBeNull();
    expect(deriveHandoffContext(['', '  ', '\n'])).toBeNull();
  });

  it('hands over plain text — escape codes would arrive as garbage glyphs', () => {
    const context = deriveHandoffContext(['\x1b[32mWrote draft.md\x1b[0m\n']);
    expect(context).toBe('Wrote draft.md');
  });

  it('drops the interface chrome that says nothing about the work', () => {
    const context = deriveHandoffContext([
      'Wrote draft.md\n',
      'esc to interrupt\n',
      '? for shortcuts\n',
      'ctrl+c to quit\n',
    ]);
    expect(context).toBe('Wrote draft.md');
  });

  it('keeps a redrawn line once instead of forty times', () => {
    // A spinner repaints the same line many times a second; without this the
    // whole budget is spent on one sentence.
    const spinner = Array.from({ length: 40 }, () => 'Thinking…\n');
    const context = deriveHandoffContext([...spinner, 'Done.\n']);
    expect(context).toBe('Thinking…\nDone.');
  });

  it('collapses a spinner that cycles its frame character', () => {
    // Real spinners rotate the glyph, so the lines are never byte-identical —
    // comparing them verbatim lets the whole budget drain into one sentence.
    const frames = ['⠋ Thinking…\n', '⠙ Thinking…\n', '⠹ Thinking…\n', '⠸ Thinking…\n'];
    const context = deriveHandoffContext([...frames, 'Done.\n']);
    expect(context).toBe('⠋ Thinking…\nDone.');
  });

  it('drops rules and progress bars that carry no words', () => {
    const context = deriveHandoffContext(['────────────\n', '███████ 62%\n', 'Saved.\n']);
    expect(context).toBe('Saved.');
  });

  it('returns null when the tail is only noise', () => {
    expect(deriveHandoffContext(['────────\n', '\x1b[2K\r', 'esc to interrupt\n'])).toBeNull();
  });

  it('keeps the newest output when the tail is longer than the budget', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}\n`);
    const context = deriveHandoffContext(long);
    expect(context).not.toBeNull();
    expect(context!.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(context).toContain('line 399');
    expect(context).not.toContain('line 0\n');
  });

  it('cuts between lines, never mid-line', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}\n`);
    const context = deriveHandoffContext(long)!;
    // Every surviving line is a whole one.
    for (const line of context.split('\n')) {
      expect(line).toMatch(/^line \d+$/);
    }
  });

  it('still hands over something when a single line exceeds the budget', () => {
    const huge = `${'x'.repeat(HANDOFF_MAX_CHARS * 2)}\n`;
    const context = deriveHandoffContext([huge]);
    expect(context).not.toBeNull();
    expect(context!.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
  });

  it('reads any CLI the same way — it never looks for a provider format', () => {
    // Whatever harness ran the step, this is stdout and nothing else. Three
    // different shapes, all of which have to survive.
    const claudeish = deriveHandoffContext(['⏺ Wrote src/draft.md (42 lines)\n']);
    const codexish = deriveHandoffContext(['[2/3] applied patch to src/draft.md\n']);
    const grokish = deriveHandoffContext(['> finished: draft saved\n']);
    expect(claudeish).toBe('⏺ Wrote src/draft.md (42 lines)');
    expect(codexish).toBe('[2/3] applied patch to src/draft.md');
    expect(grokish).toBe('> finished: draft saved');
  });
});

describe('composeStepTask', () => {
  it('leaves the prompt exactly as written when nothing came before', () => {
    expect(composeStepTask('/draft', null, 'Draft')).toBe('/draft');
  });

  it('keeps the prompt first so a slash command stays a slash command', () => {
    // Every CLI reads a leading "/" as a command. Context pushed in front of
    // it would turn the invocation into prose.
    const task = composeStepTask('/rewrite', 'Wrote draft.md', 'Draft');
    expect(task.startsWith('/rewrite')).toBe(true);
  });

  it('carries the previous output and names where it came from', () => {
    const task = composeStepTask('/rewrite', 'Wrote draft.md', 'Draft');
    expect(task).toContain('Wrote draft.md');
    expect(task).toContain('Draft');
  });

  it('says the block is a raw tail, not a summary', () => {
    // The next session must not treat truncated terminal output as a record
    // of what happened.
    const task = composeStepTask('/rewrite', 'Wrote draft.md', 'Draft');
    expect(task).toMatch(/not a summary/i);
  });
});
