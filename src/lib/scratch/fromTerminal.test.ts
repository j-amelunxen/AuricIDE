import { describe, expect, it, vi } from 'vitest';
import { saveTerminalScreen, terminalScratchMarkdown } from './fromTerminal';

const capturedAt = new Date(2026, 8, 22, 15, 4);

describe('terminalScratchMarkdown', () => {
  it('names the agent and fences the screen', () => {
    const md = terminalScratchMarkdown('Writer', 'diff --git a/src/app.ts\nhello', capturedAt);
    expect(md).toBe(
      [
        '# Writer',
        '',
        'Visible terminal, 2026-09-22 15:04.',
        '',
        '```text',
        'diff --git a/src/app.ts',
        'hello',
        '```',
        '',
      ].join('\n')
    );
  });

  it('grows the fence past backticks that appear on screen', () => {
    const md = terminalScratchMarkdown('Writer', 'use ```js here', capturedAt);
    expect(md).toContain('````text\nuse ```js here\n````');
  });

  it('strips heading characters out of the agent name', () => {
    const md = terminalScratchMarkdown('# Odd\nname', 'hi', capturedAt);
    expect(md.startsWith('# Odd name\n')).toBe(true);
  });
});

describe('saveTerminalScreen', () => {
  const screen = 'on screen';

  function deps(overrides: Partial<Parameters<typeof saveTerminalScreen>[0]> = {}) {
    return {
      agentName: 'Writer',
      screen,
      now: capturedAt,
      resolveDir: vi.fn(async () => '/data/scratches'),
      existingNames: vi.fn(() => ['scratch-1.md', 'scratch-2.md']),
      write: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('writes the next scratch and refreshes the list', async () => {
    const args = deps();
    const result = await saveTerminalScreen(args);
    expect(result).toEqual({
      ok: true,
      name: 'scratch-3.md',
      path: '/data/scratches/scratch-3.md',
    });
    expect(args.write).toHaveBeenCalledWith(
      '/data/scratches/scratch-3.md',
      terminalScratchMarkdown('Writer', screen, capturedAt)
    );
    expect(args.refresh).toHaveBeenCalledOnce();
  });

  it('does not write when the screen is empty', async () => {
    const args = deps({ screen: '   \n' });
    await expect(saveTerminalScreen(args)).resolves.toEqual({ ok: false, reason: 'empty' });
    expect(args.write).not.toHaveBeenCalled();
    expect(args.refresh).not.toHaveBeenCalled();
  });

  it('does not write when the scratch directory cannot be resolved', async () => {
    const args = deps({ resolveDir: vi.fn(async () => null) });
    await expect(saveTerminalScreen(args)).resolves.toEqual({ ok: false, reason: 'no-dir' });
    expect(args.write).not.toHaveBeenCalled();
  });

  it('leaves the list alone when the write fails', async () => {
    const args = deps({ write: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    await expect(saveTerminalScreen(args)).rejects.toThrow('disk full');
    expect(args.refresh).not.toHaveBeenCalled();
  });
});
