import { beforeEach, describe, expect, it, vi } from 'vitest';
import { llmCall } from '../tauri/llm';
import { clearFinishPolishCache } from './headlessFinish';
import { extractAskSummary, resolveLaneSummary } from './laneSummary';

vi.mock('../tauri/llm', () => ({
  llmCall: vi.fn(),
}));

// resolveLaneSummary's done/failed path shares its LLM call with
// headlessFinish.ts's cache (S1) — reset it so one test's extract cannot
// dedupe into another's just because both logs happened to say the same thing.
beforeEach(() => {
  clearFinishPolishCache();
});

describe('extractAskSummary', () => {
  it('reads the question and what it is about out of a Claude-style permission menu', () => {
    const tail = [
      'Bash(pnpm test:run src/lib/context/select.test.ts)\n',
      'Do you want to proceed?\n',
      '❯ 1. Yes\n',
      "  2. Yes, and don't ask again for pnpm commands\n",
      '  3. No\n',
    ];
    const summary = extractAskSummary(tail);
    expect(summary).toContain('Do you want to proceed?');
    expect(summary).toContain('Bash(pnpm test:run src/lib/context/select.test.ts)');
  });

  it('excludes the numbered menu options themselves from the summary', () => {
    const tail = [
      'Do you want to make this edit to fleet.ts?\n',
      '❯ 1. Yes\n',
      '  2. Yes, allow all edits during this session\n',
      '  3. No, and tell Claude what to do differently\n',
    ];
    const summary = extractAskSummary(tail);
    expect(summary).not.toContain('1. Yes');
    expect(summary).not.toContain('❯');
  });

  it('reads a bare y/n confirmation with no tool-call line above it', () => {
    expect(extractAskSummary(['Overwrite existing file? (y/n) '])).toBe(
      'Overwrite existing file? (y/n)'
    );
  });

  it('is null when the tail holds no question', () => {
    expect(
      extractAskSummary(['Reading src/lib/agents/fleet.ts\n', 'Editing fleet.test.ts\n'])
    ).toBeNull();
  });

  it('does not mistake a rhetorical question in prose for a real one', () => {
    expect(extractAskSummary(['Hmm, what does splitFleet actually return?\n'])).toBeNull();
  });

  it('is null for an empty tail', () => {
    expect(extractAskSummary([])).toBeNull();
  });

  it('strips ANSI before building the summary', () => {
    const summary = extractAskSummary(['\x1b[32mProceed? [Y/n]\x1b[0m ']);
    expect(summary).toBe('Proceed? [Y/n]');
  });

  it('falls back to the context line above a bare numbered menu with no prose question', () => {
    // The menu-option pattern in PROMPT_PATTERNS is itself what makes
    // `detectAwaitingInput` true here — there is no "Do you want to…" line at
    // all, only the tool call and the menu MENU_OPTION_LINE strips.
    const tail = ['Bash(rm -rf build)\n', '❯ 1. Yes\n  2. No, and tell Claude what to do\n'];
    expect(extractAskSummary(tail)).toBe('Permission: Bash(rm -rf build)');
  });

  it('clips to 160 characters rather than overflowing the lane rail', () => {
    const about = `Bash(${'x'.repeat(150)})`;
    const summary = extractAskSummary([`${about}\n`, 'Do you want to proceed?\n']);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(161);
    expect(summary).toContain('…');
  });
});

describe('resolveLaneSummary', () => {
  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
  });

  describe('kind: ask', () => {
    it('is the bare extract when no LLM is configured', async () => {
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Do you want to proceed?\n'],
        llmConfigured: false,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({ kind: 'ask', text: 'Do you want to proceed?', source: 'extract' })
      );
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('is null when there is nothing to ask about', async () => {
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Reading fleet.ts\n'],
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toBeNull();
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('is the polished text when a configured LLM answers in time', async () => {
      vi.mocked(llmCall).mockResolvedValueOnce({
        content: 'It wants approval to run the test suite.',
      });
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Bash(pnpm test:run)\n', 'Do you want to proceed?\n'],
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({
          kind: 'ask',
          text: 'It wants approval to run the test suite.',
          source: 'llm',
        })
      );
    });

    it('falls back to the extract when the LLM fails', async () => {
      vi.mocked(llmCall).mockRejectedValueOnce(new Error('no key'));
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Do you want to proceed?\n'],
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'Do you want to proceed?', source: 'extract' })
      );
    });

    it('falls back to the extract when the LLM is too slow', async () => {
      vi.mocked(llmCall).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'late' }), 200))
      );
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Do you want to proceed?\n'],
        llmConfigured: true,
        projectPath: '/repo',
        timeoutMs: 20,
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'Do you want to proceed?', source: 'extract' })
      );
    });
  });

  describe('kind: done / failed', () => {
    it('is the bare extract when no LLM is configured', async () => {
      const summary = await resolveLaneSummary({
        kind: 'done',
        logs: ['Deployed auric-website to production.\n'],
        llmConfigured: false,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({
          kind: 'done',
          text: 'Deployed auric-website to production.',
          source: 'extract',
        })
      );
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('is null when there is nothing to summarise', async () => {
      const summary = await resolveLaneSummary({
        kind: 'failed',
        logs: [],
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toBeNull();
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('preserves the failed kind through the polished path', async () => {
      vi.mocked(llmCall).mockResolvedValueOnce({ content: 'The build failed on the lint step.' });
      const summary = await resolveLaneSummary({
        kind: 'failed',
        logs: ['ERROR: lint failed\n'],
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({
          kind: 'failed',
          text: 'The build failed on the lint step.',
          source: 'llm',
        })
      );
    });

    it('falls back to the extract when the LLM is too slow', async () => {
      vi.mocked(llmCall).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'late' }), 200))
      );
      const summary = await resolveLaneSummary({
        kind: 'done',
        logs: ['Deployed to production.\n'],
        llmConfigured: true,
        projectPath: '/repo',
        timeoutMs: 20,
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'Deployed to production.', source: 'extract' })
      );
    });
  });

  describe('pre-computed extract', () => {
    it('uses a given ask extract instead of deriving one from the logs', async () => {
      // These logs alone hold no question — a recompute would return null.
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Reading fleet.ts\n'],
        extract: 'Do you want to proceed?',
        llmConfigured: false,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'Do you want to proceed?', source: 'extract' })
      );
    });

    it('uses a given done/failed extract instead of deriving one from the logs', async () => {
      // Empty logs alone would derive to null.
      const summary = await resolveLaneSummary({
        kind: 'done',
        logs: [],
        extract: 'Deployed to production.',
        llmConfigured: false,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'Deployed to production.', source: 'extract' })
      );
    });

    it('still polishes a given extract through a configured LLM', async () => {
      vi.mocked(llmCall).mockResolvedValueOnce({ content: 'It wants approval to deploy.' });
      const summary = await resolveLaneSummary({
        kind: 'ask',
        logs: ['Reading fleet.ts\n'],
        extract: 'Do you want to proceed?',
        llmConfigured: true,
        projectPath: '/repo',
      });
      expect(summary).toEqual(
        expect.objectContaining({ text: 'It wants approval to deploy.', source: 'llm' })
      );
    });
  });

  it('never throws even when the LLM rejects', async () => {
    vi.mocked(llmCall).mockRejectedValueOnce(new Error('network down'));
    await expect(
      resolveLaneSummary({
        kind: 'ask',
        logs: ['Do you want to proceed?\n'],
        llmConfigured: true,
        projectPath: '/repo',
      })
    ).resolves.not.toThrow();
  });
});
