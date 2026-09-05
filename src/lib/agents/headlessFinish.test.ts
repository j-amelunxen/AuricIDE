import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../tauri/agents';
import { llmCall } from '../tauri/llm';
import {
  __resetFinishPolishCacheForTests,
  announceHeadlessFinish,
  headlessFinishNotification,
  resolveFinishBody,
  resolveFinishSummary,
  shouldNotifyHeadlessFinish,
} from './headlessFinish';

vi.mock('../tauri/llm', () => ({
  llmCall: vi.fn(),
}));

// The shared-polish cache (S1: one finish, one LLM call, not one per
// consumer) is module state — without a reset, one test's finish could
// dedupe into another's just because they extracted the same text.
beforeEach(() => {
  __resetFinishPolishCacheForTests();
});

const HEADLESS: Pick<AgentConfig, 'headless' | 'runSource'> = {
  headless: true,
  runSource: 'ui',
};

describe('shouldNotifyHeadlessFinish', () => {
  it('is true only for a user-launched headless run', () => {
    expect(shouldNotifyHeadlessFinish(HEADLESS)).toBe(true);
    expect(shouldNotifyHeadlessFinish({ headless: true })).toBe(true);
  });

  it('stays quiet for an interactive run — those are watched', () => {
    expect(shouldNotifyHeadlessFinish({ headless: false, runSource: 'ui' })).toBe(false);
    expect(shouldNotifyHeadlessFinish({ runSource: 'ui' })).toBe(false);
    expect(shouldNotifyHeadlessFinish(undefined)).toBe(false);
  });

  // Conductor tickets run headless so the verdict is collected on exit.
  // A ping per ticket would train the user to ignore the inbox.
  it('does not fire for conductor-spawned agents, even when they are headless', () => {
    expect(shouldNotifyHeadlessFinish({ headless: true, runSource: 'conductor' })).toBe(false);
  });
});

describe('headlessFinishNotification', () => {
  it('names the agent, points back at its logs, and is a success', () => {
    expect(
      headlessFinishNotification({
        agentId: 'a1',
        name: 'Deploy Auric-Website',
        repoPath: '/Users/jen/auric-website',
        body: 'The site is live.',
      })
    ).toEqual({
      source: 'system',
      origin: 'Deploy Auric-Website',
      severity: 'success',
      title: 'Deploy Auric-Website finished',
      body: 'The site is live.',
      projectPath: '/Users/jen/auric-website',
      projectName: 'auric-website',
      refKind: 'agent',
      refId: 'a1',
      dedupeKey: 'agent:a1:done',
      actions: [
        {
          id: 'logs',
          label: 'Open logs',
          kind: 'open',
          target: { type: 'agent', agentId: 'a1' },
        },
      ],
    });
  });
});

describe('resolveFinishBody', () => {
  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
  });

  it('uses the agent output when no LLM is configured', async () => {
    const body = await resolveFinishBody({
      logs: ['Deployed auric-website to production.\n'],
      llmConfigured: false,
      projectPath: '/repo',
    });
    expect(body).toBe('Deployed auric-website to production.');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('lets a configured LLM rewrite the tail into a glanceable status', async () => {
    vi.mocked(llmCall).mockResolvedValueOnce({ content: 'The site is live on production.' });
    const body = await resolveFinishBody({
      logs: ['ran pnpm build\n', 'uploaded dist/ via rsync\n', 'done\n'],
      task: 'Deploy auric-website',
      llmConfigured: true,
      projectPath: '/repo',
    });
    expect(body).toBe('The site is live on production.');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('strips a fenced LLM reply down to the status line', async () => {
    vi.mocked(llmCall).mockResolvedValueOnce({
      content: '```\n"The site is live."\n```',
    });
    const body = await resolveFinishBody({
      logs: ['done\n'],
      llmConfigured: true,
      projectPath: '/repo',
    });
    expect(body).toBe('The site is live.');
  });

  it('falls back to the extract when the LLM fails', async () => {
    vi.mocked(llmCall).mockRejectedValueOnce(new Error('no key'));
    const body = await resolveFinishBody({
      logs: ['Deployed auric-website to production.\n'],
      llmConfigured: true,
      projectPath: '/repo',
    });
    expect(body).toBe('Deployed auric-website to production.');
  });

  it('falls back to the extract when the LLM is too slow', async () => {
    vi.mocked(llmCall).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ content: 'late' }), 200))
    );
    const body = await resolveFinishBody({
      logs: ['Deployed auric-website to production.\n'],
      llmConfigured: true,
      projectPath: '/repo',
      llmTimeoutMs: 20,
    });
    expect(body).toBe('Deployed auric-website to production.');
  });

  it('does not call the LLM when there is nothing to summarise', async () => {
    const body = await resolveFinishBody({
      logs: [],
      llmConfigured: true,
      projectPath: '/repo',
    });
    expect(body).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });
});

describe('resolveFinishSummary — one shared model call per finish', () => {
  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
  });

  // resolveFinishSummary has two independent callers reaching it with the
  // same extract, task and project path in the same tick — the headless
  // notification path (resolveFinishBody) and the lane summary subscriber.
  // Without sharing the underlying call, one finish becomes two identical
  // round trips to the model.
  it('shares one in-flight LLM call across concurrent callers with the same extract, task and project', async () => {
    let released: (value: { content: string }) => void = () => {};
    vi.mocked(llmCall).mockImplementationOnce(() => new Promise((resolve) => (released = resolve)));

    const input = {
      logs: ['Deployed auric-website to production.\n'],
      task: 'Deploy auric-website',
      llmConfigured: true,
      projectPath: '/repo',
    };
    const first = resolveFinishSummary(input);
    const second = resolveFinishSummary(input);

    expect(llmCall).toHaveBeenCalledTimes(1);
    released({ content: 'The site is live on production.' });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ text: 'The site is live on production.', source: 'llm' });
    expect(secondResult).toEqual({ text: 'The site is live on production.', source: 'llm' });
  });

  it('makes a fresh call once the shared result has expired', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(llmCall).mockResolvedValueOnce({ content: 'First answer.' });
      const input = {
        logs: ['Deployed auric-website to production.\n'],
        llmConfigured: true,
        projectPath: '/repo',
      };
      await resolveFinishSummary(input);
      expect(llmCall).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);

      vi.mocked(llmCall).mockResolvedValueOnce({ content: 'Second answer.' });
      const result = await resolveFinishSummary(input);

      expect(llmCall).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ text: 'Second answer.', source: 'llm' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('announceHeadlessFinish', () => {
  it('dispatches the finished row with the resolved body', async () => {
    const dispatch = vi.fn(async () => undefined);
    await announceHeadlessFinish({
      agentId: 'a1',
      name: 'Deploy Auric-Website',
      repoPath: '/repo',
      logs: ['The site is live.\n'],
      llmConfigured: false,
      projectPath: '/repo',
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Deploy Auric-Website finished',
        body: 'The site is live.',
        severity: 'success',
      })
    );
  });
});
