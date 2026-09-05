import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import type { AgentConfig, AgentInfo } from '../tauri/agents';
import { clearFinishPolishCache } from './headlessFinish';
import { installLaneSummarySubscriber } from './laneSummarySubscriber';

vi.mock('../tauri/llm', () => ({
  llmCall: vi.fn(),
}));
import { llmCall } from '../tauri/llm';

function makeAgent(overrides: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    name: overrides.id,
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: Date.now(),
    ...overrides,
  };
}

/** A promise this test releases by hand, to pin exactly when a polish "lands". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

/**
 * Wraps an agents array so the test can observe whether it was ever iterated
 * — `for...of` (and anything else that walks the fleet) reads
 * `Symbol.iterator` exactly once per pass, with no need to know how the
 * subscriber's loop is written internally.
 */
function trackedAgents(agents: AgentInfo[]) {
  let iterations = 0;
  const proxy = new Proxy(agents, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) iterations += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    agents: proxy,
    get iterations() {
      return iterations;
    },
  };
}

describe('installLaneSummarySubscriber', () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
    clearFinishPolishCache();
    useStore.setState({
      agents: [],
      agentLogs: {},
      laneSummaries: {},
      llmConfigured: false,
      agentSpawnConfigs: {},
      rootPath: null,
    });
    unsubscribe = installLaneSummarySubscriber();
  });

  afterEach(() => {
    unsubscribe();
  });

  it('sets an ask summary the moment an agent starts waiting on input', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false })],
      agentLogs: { a1: ['Bash(pnpm build)\n', 'Do you want to proceed?\n'] },
    });

    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: true })] });

    await vi.waitFor(() => {
      expect(useStore.getState().laneSummaries.a1).toMatchObject({
        kind: 'ask',
        source: 'extract',
      });
    });
    expect(useStore.getState().laneSummaries.a1?.text).toContain('Do you want to proceed?');
  });

  it('does not set a summary on an agent’s first sighting, only on a real transition', () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
    });

    expect(useStore.getState().laneSummaries.a1).toBeUndefined();
  });

  it('replaces the extract with the polished text once a configured LLM answers', async () => {
    vi.mocked(llmCall).mockResolvedValueOnce({ content: 'It wants approval to run the build.' });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
      agentLogs: { a1: ['Bash(pnpm build)\n', 'Do you want to proceed?\n'] },
      llmConfigured: true,
    });

    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });

    await vi.waitFor(() => {
      expect(useStore.getState().laneSummaries.a1).toEqual(
        expect.objectContaining({
          kind: 'ask',
          source: 'llm',
          text: 'It wants approval to run the build.',
        })
      );
    });
  });

  it('clears the ask summary once the agent stops waiting on input', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
    });
    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: true })] });
    await vi.waitFor(() => expect(useStore.getState().laneSummaries.a1).toBeDefined());

    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: false })] });

    expect(useStore.getState().laneSummaries.a1).toBeUndefined();
  });

  it('leaves a done/failed summary alone when the agent stops waiting on input', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running' })],
      agentLogs: { a1: ['Deployed to production.\n'] },
    });
    useStore.setState({ agents: [makeAgent({ id: 'a1', status: 'idle' })] });
    await vi.waitFor(() => expect(useStore.getState().laneSummaries.a1).toBeDefined());

    // awaitingInput was never true here, so this must not clear the done summary.
    useStore.setState({ agents: [makeAgent({ id: 'a1', status: 'idle', awaitingInput: false })] });

    expect(useStore.getState().laneSummaries.a1?.kind).toBe('done');
  });

  it('summarises a finished run when status goes to idle', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running' })],
      agentLogs: { a1: ['Deployed to production.\n'] },
    });

    useStore.setState({ agents: [makeAgent({ id: 'a1', status: 'idle' })] });

    await vi.waitFor(() => {
      expect(useStore.getState().laneSummaries.a1).toMatchObject({
        kind: 'done',
        source: 'extract',
      });
    });
  });

  it('summarises a failed run when status goes to error', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running' })],
      agentLogs: { a1: ['ERROR: build failed\n'] },
    });

    useStore.setState({ agents: [makeAgent({ id: 'a1', status: 'error' })] });

    await vi.waitFor(() => {
      expect(useStore.getState().laneSummaries.a1).toMatchObject({
        kind: 'failed',
        source: 'extract',
      });
    });
  });

  it('fires exactly once per transition — a later render with the same state does not re-fire', async () => {
    vi.mocked(llmCall).mockResolvedValue({ content: 'Approve the build?' });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
      llmConfigured: true,
    });

    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });
    await vi.waitFor(() => expect(llmCall).toHaveBeenCalledTimes(1));

    // Same awaitingInput value again, plus an unrelated field changing.
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });
    useStore.setState({ agentLogs: { a1: ['Do you want to proceed?\n', 'still waiting\n'] } });

    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('drops an agent’s marker when it vanishes, so a reused id starts fresh', () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
    });

    // The agent vanishes entirely (killed/dismissed).
    useStore.setState({ agents: [] });

    // A new agent reuses the id and is already awaiting input on first sighting.
    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: true })] });
    expect(useStore.getState().laneSummaries.a1).toBeUndefined();

    // Only a genuine transition after that first sighting fires.
    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: false })] });
    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: true })] });
    expect(useStore.getState().laneSummaries.a1).toBeDefined();
  });

  it('does not walk the fleet again when a later write leaves `agents` unchanged', () => {
    const tracked = trackedAgents([makeAgent({ id: 'a1' })]);
    useStore.setState({ agents: tracked.agents });
    expect(tracked.iterations).toBe(1);

    // `agents` itself is untouched — only unrelated fields change, the way a
    // PTY chunk or an unrelated store write does for most of the app.
    useStore.setState({ agentLogs: { a1: ['noise\n'] } });
    useStore.setState({ agentLogs: { a1: ['more noise\n'] } });

    expect(tracked.iterations).toBe(1);
  });

  it('makes exactly one LLM call for one headless finish, not one per consumer', async () => {
    vi.mocked(llmCall).mockResolvedValue({ content: 'Deployed to production.' });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running', repoPath: '/repo' })],
      agentLogs: { a1: ['Deployed to production.\n'] },
      llmConfigured: true,
      agentSpawnConfigs: {
        a1: {
          name: 'a1',
          model: 'sonnet',
          task: 'deploy',
          headless: true,
          cwd: '/repo',
        } as AgentConfig,
      },
    });

    useStore.getState().updateAgentStatus('a1', 'idle');

    await vi.waitFor(() => expect(llmCall).toHaveBeenCalledTimes(1));
    await flushMicrotasks();
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a cleared ask summary when its polish lands late', async () => {
    const pending = deferred<{ content: string }>();
    vi.mocked(llmCall).mockReturnValueOnce(pending.promise);
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
      llmConfigured: true,
    });

    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });
    await vi.waitFor(() => expect(llmCall).toHaveBeenCalledTimes(1));
    expect(useStore.getState().laneSummaries.a1?.kind).toBe('ask');

    // The agent stops waiting before the LLM answers.
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
    });
    expect(useStore.getState().laneSummaries.a1).toBeUndefined();

    // The late polish finally lands.
    pending.resolve({ content: 'Approve deleting the build directory?' });
    await flushMicrotasks();

    expect(useStore.getState().laneSummaries.a1).toBeUndefined();
  });

  it('does not let a late ask polish overwrite a done summary that landed after it', async () => {
    const pending = deferred<{ content: string }>();
    vi.mocked(llmCall).mockImplementation(async () => ({ content: 'Deployed to production.' }));
    vi.mocked(llmCall).mockReturnValueOnce(pending.promise);
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, status: 'running', repoPath: '/repo' })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
      llmConfigured: true,
    });

    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, status: 'running', repoPath: '/repo' })],
    });
    await vi.waitFor(() => expect(llmCall).toHaveBeenCalledTimes(1));

    // The agent finishes while the ask polish is still in flight — awaitingInput
    // drops back to false in the very same update as the status change.
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, status: 'idle', repoPath: '/repo' })],
      agentLogs: { a1: ['Do you want to proceed?\n', 'Deployed to production.\n'] },
    });
    await vi.waitFor(() => expect(useStore.getState().laneSummaries.a1?.kind).toBe('done'));

    // The late ask polish finally lands.
    pending.resolve({ content: 'Approve deleting the build directory?' });
    await flushMicrotasks();

    expect(useStore.getState().laneSummaries.a1?.kind).toBe('done');
  });

  it('polishes an agent with no repoPath using the open project instead', async () => {
    vi.mocked(llmCall).mockResolvedValueOnce({ content: 'Approve the build?' });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
      llmConfigured: true,
      rootPath: '/open/project',
    });

    useStore.setState({ agents: [makeAgent({ id: 'a1', awaitingInput: true })] });

    await vi.waitFor(() => {
      expect(useStore.getState().laneSummaries.a1).toMatchObject({ source: 'llm' });
    });
  });

  it('does not send more than one ask polish per cooldown window when awaitingInput flaps', () => {
    vi.mocked(llmCall).mockResolvedValue({ content: 'Approve the build?' });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
      agentLogs: { a1: ['Do you want to proceed?\n'] },
      llmConfigured: true,
    });

    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });
    expect(llmCall).toHaveBeenCalledTimes(1);

    // A redraw pushes the prompt out of the detection window and back in —
    // two more genuine transitions, well inside the cooldown.
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: false, repoPath: '/repo' })],
    });
    useStore.setState({
      agents: [makeAgent({ id: 'a1', awaitingInput: true, repoPath: '/repo' })],
    });

    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('forgets an agent’s lane summary once it vanishes from the fleet', async () => {
    useStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'running' })],
      agentLogs: { a1: ['Deployed to production.\n'] },
    });
    useStore.setState({ agents: [makeAgent({ id: 'a1', status: 'idle' })] });
    await vi.waitFor(() => expect(useStore.getState().laneSummaries.a1).toBeDefined());

    useStore.setState({ agents: [] });

    expect(useStore.getState().laneSummaries.a1).toBeUndefined();
  });

  it('installing again does not open a second subscription', () => {
    const spy = vi.spyOn(useStore, 'subscribe');
    const again = installLaneSummarySubscriber();
    expect(again).toBe(unsubscribe);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('subscribes again after the previous subscription was torn down', () => {
    unsubscribe();
    const spy = vi.spyOn(useStore, 'subscribe');
    unsubscribe = installLaneSummarySubscriber();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
