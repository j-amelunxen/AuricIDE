import { describe, expect, it } from 'vitest';
import { resolveMatcher } from './index';

describe('resolveMatcher', () => {
  it('picks the Claude matcher for the exact id', () => {
    expect(resolveMatcher('claude')('⏺ Bash(pnpm lint)\n')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
  });

  it('picks the Claude matcher for an id that only contains "claude"', () => {
    expect(resolveMatcher('claude-code')('⏺ Bash(pnpm lint)\n')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
    expect(resolveMatcher('my-claude-wrapper')('⏺ Bash(pnpm lint)\n')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
  });

  it('matches the Claude family case-insensitively', () => {
    expect(resolveMatcher('Claude-Code')('⏺ Bash(pnpm lint)\n')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
  });

  it('picks the Codex matcher for any id containing "codex"', () => {
    expect(resolveMatcher('codex')('$ pnpm lint')).toEqual({ kind: 'run', label: 'Ran pnpm lint' });
    expect(resolveMatcher('codex-cli')('$ pnpm lint')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
  });

  it('falls back to the generic matcher for anything outside those families', () => {
    expect(resolveMatcher('crush')('$ pnpm lint')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
    expect(resolveMatcher('gemini')('$ pnpm lint')).toEqual({
      kind: 'run',
      label: 'Ran pnpm lint',
    });
  });

  it('returns a fresh Claude matcher instance on every call', () => {
    const first = resolveMatcher('claude');
    first('⏺ Bash(pnpm lint)\n');
    const second = resolveMatcher('claude');
    // The second matcher has no "last tool call" memory of its own, so a
    // question with no prior tool line falls back to the question text.
    expect(second('Do you want to proceed?\n')).toEqual({
      kind: 'ask',
      label: 'Permission requested: Do you want to proceed?',
    });
  });
});
