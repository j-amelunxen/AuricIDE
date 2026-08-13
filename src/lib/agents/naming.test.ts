import { describe, expect, it } from 'vitest';
import { AGENT_NAME_MAX_CHARS, deriveAgentName, uniqueAgentName } from './naming';

describe('deriveAgentName', () => {
  it('names the agent after what it was asked to do', () => {
    expect(deriveAgentName('Fix the login redirect')).toBe('Fix the login redirect');
  });

  it('uses only the first line of a long instruction', () => {
    expect(deriveAgentName('Refactor the parser\n\nDetails follow:\n- step one')).toBe(
      'Refactor the parser'
    );
  });

  it('shortens at a word boundary rather than mid-word', () => {
    const task = 'Rewrite the dependency resolution so cycles are reported instead of hanging';
    const name = deriveAgentName(task);

    expect(name.length).toBeLessThanOrEqual(AGENT_NAME_MAX_CHARS + 1);
    expect(name.endsWith('…')).toBe(true);

    // What survives must be whole words: the source continues with a space.
    const kept = name.slice(0, -1);
    expect(task.startsWith(kept)).toBe(true);
    expect(task[kept.length]).toBe(' ');
  });

  it('drops a polite opener that says nothing about the work', () => {
    expect(deriveAgentName('Please fix the login redirect')).toBe('Fix the login redirect');
    expect(deriveAgentName('Can you fix the login redirect')).toBe('Fix the login redirect');
  });

  it('capitalises the first word', () => {
    expect(deriveAgentName('fix the login redirect')).toBe('Fix the login redirect');
  });

  it('collapses whitespace from a pasted instruction', () => {
    expect(deriveAgentName('  Fix   the   redirect  ')).toBe('Fix the redirect');
  });

  it('falls back to the repo when there is no instruction', () => {
    expect(deriveAgentName('', 'auric-ide')).toBe('Agent (auric-ide)');
    expect(deriveAgentName('   ', 'auric-ide')).toBe('Agent (auric-ide)');
  });

  it('falls back again when the instruction is only punctuation', () => {
    expect(deriveAgentName('...', 'auric-ide')).toBe('Agent (auric-ide)');
  });

  it('falls back to a plain name without a repo', () => {
    expect(deriveAgentName('')).toBe('Agent');
  });

  it('keeps the placeholder prompt from turning into a name', () => {
    // Retry of a failed agent can still carry a stored 'wait' task.
    expect(deriveAgentName('wait', 'auric-ide')).toBe('Agent (auric-ide)');
  });
});

describe('uniqueAgentName', () => {
  it('leaves a name alone when nothing clashes', () => {
    expect(uniqueAgentName('Fix the redirect', ['Refactor parser'])).toBe('Fix the redirect');
  });

  it('numbers a repeated name so the fleet stays readable', () => {
    expect(uniqueAgentName('Fix the redirect', ['Fix the redirect'])).toBe('Fix the redirect 2');
  });

  it('keeps counting past an already numbered name', () => {
    expect(uniqueAgentName('Fix the redirect', ['Fix the redirect', 'Fix the redirect 2'])).toBe(
      'Fix the redirect 3'
    );
  });

  it('does not renumber a name that merely starts the same', () => {
    expect(uniqueAgentName('Fix', ['Fix the redirect'])).toBe('Fix');
  });
});
