import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AgentInfo } from '../tauri/agents';
import { agentLogAppend } from '../tauri/agentLog';
import { resetAgentLogWriter } from '../agents/events/persistence';
import { resetAgentExtractors } from '../agents/events/registry';
import { createAgentSlice, MAX_AGENT_LOGS, type AgentSlice } from './agentSlice';

vi.mock('../tauri/agentLog', () => ({
  agentLogAppend: vi.fn(async () => undefined),
  agentLogLoad: vi.fn(async () => []),
  agentLogPrune: vi.fn(async () => 0),
  agentLogPurge: vi.fn(async () => undefined),
}));

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    status: 'running',
    model: 'model-a',
    provider: 'claude',
    startedAt: 1,
    ...extra,
  };
}

let store: StoreApi<AgentSlice>;

beforeEach(() => {
  vi.clearAllMocks();
  resetAgentLogWriter();
  resetAgentExtractors();
  store = createStore<AgentSlice>()(createAgentSlice);
});

describe('appendAgentTerminalChunks — the agent window’s write path', () => {
  // A tool call and a permission prompt: through `appendAgentLog` this text
  // yields events, stream lines, an activity bump and an awaiting-input flag.
  const LOUD = ['⏺ Bash(ls -la)\r\n', 'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'];

  it('appends the chunks and advances seq once per chunk', () => {
    store.getState().appendAgentTerminalChunks('a1', ['one', 'two']);
    store.getState().appendAgentTerminalChunks('a1', ['three']);

    expect(store.getState().agentLogs.a1).toEqual(['one', 'two', 'three']);
    expect(store.getState().agentLogMeta.a1).toEqual({ seq: 3, bytes: 11 });
  });

  it('writes nothing but the log: the roster stays the only author of agents', () => {
    store.setState({ agents: [agent('a1', { lastActivityAt: 0 })] });
    const before = store.getState();

    store.getState().appendAgentTerminalChunks('a1', LOUD);

    const after = store.getState();
    expect(after.agentLogs.a1).toEqual(LOUD);
    expect(after.agents).toBe(before.agents);
    expect(after.agentEvents).toBe(before.agentEvents);
    expect(after.agentStreamLines).toBe(before.agentStreamLines);
    expect(after.agentHeartbeat).toBe(before.agentHeartbeat);
    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('is the control for the test above: the main window’s path does derive from this text', () => {
    store.setState({ agents: [agent('a1', { lastActivityAt: 0 })] });
    const before = store.getState();

    store.getState().appendAgentLogBatch([['a1', LOUD]]);

    expect(store.getState().agents).not.toBe(before.agents);
  });

  it('keeps the same caps as the main window’s log', () => {
    const chunks = Array.from({ length: MAX_AGENT_LOGS + 10 }, (_, i) => `c${i}`);
    store.getState().appendAgentTerminalChunks('a1', chunks);

    expect(store.getState().agentLogs.a1).toHaveLength(MAX_AGENT_LOGS);
    expect(store.getState().agentLogs.a1.at(-1)).toBe(`c${MAX_AGENT_LOGS + 9}`);
    expect(store.getState().agentLogMeta.a1.seq).toBe(MAX_AGENT_LOGS + 10);
  });

  it('leaves the store alone for an empty batch', () => {
    const before = store.getState();
    store.getState().appendAgentTerminalChunks('a1', []);
    expect(store.getState()).toBe(before);
  });
});

describe('agent window view state', () => {
  it('starts docked, with nothing shown', () => {
    expect(store.getState().agentWindowOpen).toBe(false);
    expect(store.getState().agentWindowActiveAgentId).toBeNull();
    expect(store.getState().agentWindowErrorDigests).toEqual({});
  });

  it('tracks whether the window is open, and which agent it shows', () => {
    store.getState().setAgentWindowOpen(true);
    store.getState().setAgentWindowActiveAgentId('a2');
    expect(store.getState().agentWindowOpen).toBe(true);
    expect(store.getState().agentWindowActiveAgentId).toBe('a2');
  });
});

describe('applyAgentRoster', () => {
  it('replaces the agents wholesale and takes the digests', () => {
    store.setState({ agents: [agent('gone')] });
    const agents = [agent('a1'), agent('a2', { status: 'error' })];

    store.getState().applyAgentRoster({ agents, errorDigests: { a2: 'exit code 1' } });

    expect(store.getState().agents).toBe(agents);
    expect(store.getState().agentWindowErrorDigests).toEqual({ a2: 'exit code 1' });
  });

  it('drops the log of an agent that left the roster', () => {
    store.setState({ agents: [agent('a1'), agent('gone')] });
    store.getState().appendAgentTerminalChunks('a1', ['keep']);
    store.getState().appendAgentTerminalChunks('gone', ['drop']);

    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: {} });

    expect(Object.keys(store.getState().agentLogs)).toEqual(['a1']);
    expect(Object.keys(store.getState().agentLogMeta)).toEqual(['a1']);
  });

  it('keeps the log of an agent the roster has not caught up with yet', () => {
    store.setState({ agents: [agent('a1')] });
    store.getState().appendAgentTerminalChunks('just-started', ['first output']);

    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: {} });

    expect(store.getState().agentLogs['just-started']).toEqual(['first output']);
  });

  it('keeps the log records and digests by reference when nothing about them changed', () => {
    store.getState().appendAgentTerminalChunks('a1', ['keep']);
    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: { a1: 'x' } });
    const before = store.getState();

    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: { a1: 'x' } });

    expect(store.getState().agentLogs).toBe(before.agentLogs);
    expect(store.getState().agentLogMeta).toBe(before.agentLogMeta);
    expect(store.getState().agentWindowErrorDigests).toBe(before.agentWindowErrorDigests);
  });

  it('moves on to the first agent when the one shown is gone', () => {
    store.getState().applyAgentRoster({ agents: [agent('a1'), agent('a2')], errorDigests: {} });
    store.getState().setAgentWindowActiveAgentId('a2');

    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: {} });
    expect(store.getState().agentWindowActiveAgentId).toBe('a1');

    store.getState().applyAgentRoster({ agents: [], errorDigests: {} });
    expect(store.getState().agentWindowActiveAgentId).toBeNull();
  });

  it('leaves the shown agent alone while it is still there', () => {
    store.getState().applyAgentRoster({ agents: [agent('a1'), agent('a2')], errorDigests: {} });
    store.getState().setAgentWindowActiveAgentId('a2');
    store.getState().applyAgentRoster({ agents: [agent('a1'), agent('a2')], errorDigests: {} });
    expect(store.getState().agentWindowActiveAgentId).toBe('a2');
  });
});

describe('applyAgentRoster — an empty window fills up again', () => {
  it('shows the first agent of a roster that follows an empty welcome', () => {
    store.getState().applyAgentRoster({ agents: [], errorDigests: {} });
    expect(store.getState().agentWindowActiveAgentId).toBeNull();

    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: {} });

    expect(store.getState().agentWindowActiveAgentId).toBe('a1');
  });

  it('shows a new agent after the last one was dismissed', () => {
    store.getState().applyAgentRoster({ agents: [agent('a1')], errorDigests: {} });
    store.getState().applyAgentRoster({ agents: [], errorDigests: {} });

    store.getState().applyAgentRoster({ agents: [agent('a2')], errorDigests: {} });

    expect(store.getState().agentWindowActiveAgentId).toBe('a2');
  });
});
