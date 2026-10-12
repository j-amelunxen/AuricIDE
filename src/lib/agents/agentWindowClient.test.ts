import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import fixtures from './agentWindow.fixtures.json';
import { OUTPUT_FLUSH_FALLBACK_MS } from './outputBatcher';
import { MAX_AGENT_LOG_BYTES } from '@/lib/store/agent/agentTypes';

const { hostEvents, clientEvents } = fixtures;

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Handler>();
const listening = new Map<string, () => void>();
const stopped: string[] = [];
const sendToWindowMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/tauri/agentWindow', async (original) => ({
  ...(await original<typeof import('@/lib/tauri/agentWindow')>()),
  sendToWindow: (...args: unknown[]) => sendToWindowMock(...args),
  onWindowMessage: (name: string, handler: Handler, onListening?: () => void) => {
    listeners.set(name, handler);
    if (onListening) listening.set(name, onListening);
    return () => void stopped.push(name);
  },
}));

// Rust's `agent-output` broadcast is whatever a test calls `output` with.
let output: Handler = () => {};
const onAgentStatusMock = vi.fn(() => () => {});
vi.mock('@/lib/tauri/agentEvents', () => ({
  onAgentOutput: (handler: Handler, onListening?: () => void) => {
    output = handler;
    if (onListening) listening.set('agent-output', onListening);
    return () => void stopped.push('agent-output');
  },
  onAgentStatus: () => onAgentStatusMock(),
}));

const uninstallResizeSync = vi.fn();
const installPtyResizeSyncMock = vi.fn(() => uninstallResizeSync);
vi.mock('@/lib/tauri/terminal', () => ({ installPtyResizeSync: () => installPtyResizeSyncMock() }));

const seedAgentMirrorMock = vi.fn();
const disposeAgentMirrorMock = vi.fn();
vi.mock('@/lib/terminal/agentMirror', () => ({
  seedAgentMirror: (...args: unknown[]) => seedAgentMirrorMock(...args),
  disposeAgentMirror: (...args: unknown[]) => disposeAgentMirrorMock(...args),
}));

const { useStore } = await import('@/lib/store');
const { installAgentWindowClient, sendAgentWindowAction } = await import('./agentWindowClient');

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    status: 'running',
    model: 'model-a',
    provider: 'provider-a',
    startedAt: 1,
    ...extra,
  };
}

const roster = (...ids: string[]) => ({ agents: ids.map((id) => agent(id)), errorDigests: {} });
const welcome = (ids: string[], extra: Record<string, unknown> = {}) => ({
  ...roster(...ids),
  activeAgentId: null,
  gridCells: null,
  ...extra,
});
const snapshot = (agentId: string, endOffset: number, data = `screen of ${agentId}`) => ({
  agentId,
  data,
  rows: 50,
  cols: 160,
  endOffset,
});
const batch = (agentId: string, line: string, endOffset: number) => ({
  agentId,
  stream: 'stdout',
  line,
  timestamp: 1,
  repoPath: null,
  endOffset,
});

/** Messages sent to the main window under one event name, payloads only. */
const sent = (event: string) =>
  sendToWindowMock.mock.calls
    .filter(([label, name]) => label === fixtures.windows.main && name === event)
    .map(([, , payload]) => payload);
const requested = () =>
  sent(clientEvents.snapshotRequest).map((payload) => (payload as { agentId: string }).agentId);

const receive = (event: string, payload?: unknown) => listeners.get(event)?.(payload);
const allListening = () => listening.forEach((ready) => ready());
/** Let the client's own output batcher hand over what it holds. */
const nextFrame = () => vi.advanceTimersByTime(OUTPUT_FLUSH_FALLBACK_MS);
const logOf = (agentId: string) => useStore.getState().agentLogs[agentId] ?? [];

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners.clear();
  listening.clear();
  stopped.length = 0;
  useStore.setState({
    agents: [],
    agentLogs: {},
    agentLogMeta: {},
    terminalGridCells: null,
    agentWindowActiveAgentId: null,
    agentWindowErrorDigests: {},
  });
  uninstall = installAgentWindowClient();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

describe('installAgentWindowClient — saying hello', () => {
  it('says hello only once it can hear every answer, the live output included', () => {
    for (const [name, ready] of listening) {
      expect(sent(clientEvents.hello)).toHaveLength(0);
      expect(name).toBeTruthy();
      ready();
    }
    expect(listening.size).toBe(6);
    expect(sent(clientEvents.hello)).toHaveLength(1);
  });

  it('says hello again whenever the main window announces itself', () => {
    allListening();
    receive(hostEvents.hostReady);
    receive(hostEvents.hostReady);
    expect(sent(clientEvents.hello)).toHaveLength(3);
  });

  it('keeps PTY geometry in step across windows, and stops everything on uninstall', () => {
    expect(installPtyResizeSyncMock).toHaveBeenCalledTimes(1);

    uninstall?.();
    uninstall = null;

    expect(uninstallResizeSync).toHaveBeenCalledTimes(1);
    const { _comment, ...fromHost } = hostEvents;
    expect(stopped.sort()).toEqual(['agent-output', ...Object.values(fromHost)].sort());
  });
});

describe('welcome, roster, show', () => {
  it('takes the roster, the grid and the agent to show from the welcome', () => {
    const grid = ['agent-1', 'agent-2', 'agent-1', 'agent-2'];
    receive(hostEvents.welcome, {
      agents: [agent('agent-1'), agent('agent-2', { status: 'error' })],
      errorDigests: { 'agent-2': 'exit code 1' },
      activeAgentId: 'agent-2',
      gridCells: grid,
    });

    const state = useStore.getState();
    expect(state.agents.map((a) => a.id)).toEqual(['agent-1', 'agent-2']);
    expect(state.agentWindowErrorDigests).toEqual({ 'agent-2': 'exit code 1' });
    expect(state.agentWindowActiveAgentId).toBe('agent-2');
    expect(state.terminalGridCells).toEqual(grid);
  });

  it('shows the first agent when the welcome names none, or one that is gone', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-1');

    uninstall?.();
    useStore.setState({ agents: [], agentWindowActiveAgentId: null });
    uninstall = installAgentWindowClient();
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2'], { activeAgentId: 'agent-7' }));
    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-1');
  });

  it('keeps its own layout when a restarted main window welcomes it empty-handed', () => {
    const grid = ['agent-1', 'agent-2', 'agent-1', 'agent-2'] as const;
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    useStore.getState().setTerminalGridCells(grid);
    useStore.getState().setAgentWindowActiveAgentId('agent-2');

    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));

    expect(useStore.getState().terminalGridCells).toEqual(grid);
    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-2');
  });

  it('takes a later roster as it is, and a show as the agent to bring up', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.roster, roster('agent-1', 'agent-2'));
    receive(hostEvents.show, { agentId: 'agent-2' });

    expect(useStore.getState().agents.map((a) => a.id)).toEqual(['agent-1', 'agent-2']);
    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-2');
  });

  it('lets go of an agent that left the roster', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    receive(hostEvents.snapshot, snapshot('agent-1', 0));
    receive(hostEvents.snapshot, snapshot('agent-2', 0));
    sendToWindowMock.mockClear();

    receive(hostEvents.roster, roster('agent-1'));
    expect(disposeAgentMirrorMock).toHaveBeenCalledWith('agent-2');

    // Should the id ever come back, it is a stranger again and gets a screen.
    receive(hostEvents.roster, roster('agent-1', 'agent-2'));
    expect(requested()).toEqual(['agent-2']);
  });

  it('drops a payload that breaks the contract, naming message and field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    receive(hostEvents.welcome, { ...welcome(['agent-1']), gridCells: ['a', 'b', 'c'] });
    receive(hostEvents.roster, { agents: [{ id: 'agent-1', name: 'x' }], errorDigests: {} });
    receive(hostEvents.show, { agentId: '' });

    expect(useStore.getState().agents).toEqual([]);
    expect(useStore.getState().agentWindowActiveAgentId).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('welcome.gridCells'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('roster.agents.0'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('show.agentId'));
    warn.mockRestore();
  });
});

describe('snapshots — one request at a time', () => {
  it('asks for one agent’s screen, and for the next only once that one arrived', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2', 'agent-3']));
    expect(requested()).toEqual(['agent-1']);

    receive(hostEvents.snapshot, snapshot('agent-1', 0));
    expect(requested()).toEqual(['agent-1', 'agent-2']);

    receive(hostEvents.snapshot, snapshot('agent-2', 0));
    receive(hostEvents.snapshot, snapshot('agent-3', 0));
    expect(requested()).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('asks for the agent on show first', () => {
    receive(
      hostEvents.welcome,
      welcome(['agent-1', 'agent-2', 'agent-3'], { activeAgentId: 'agent-3' })
    );
    expect(requested()).toEqual(['agent-3']);
  });

  it('seeds the mirror with the snapshot and its geometry', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.snapshot, snapshot('agent-1', 4096, 'SCREEN'));

    expect(seedAgentMirrorMock).toHaveBeenCalledTimes(1);
    expect(seedAgentMirrorMock).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ data: 'SCREEN', rows: 50, cols: 160 })
    );
  });

  it('asks for an agent that joins the roster later', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.snapshot, snapshot('agent-1', 0));

    receive(hostEvents.roster, roster('agent-1', 'agent-2'));

    expect(requested()).toEqual(['agent-1', 'agent-2']);
  });

  it('does not seed again what it already has when the main window comes back', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    receive(hostEvents.snapshot, snapshot('agent-1', 10));
    seedAgentMirrorMock.mockClear();
    sendToWindowMock.mockClear();

    // The request for agent-2 died with the old main window.
    receive(hostEvents.hostReady);
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));

    expect(requested()).toEqual(['agent-2']);
    receive(hostEvents.snapshot, snapshot('agent-1', 99, 'a second picture'));
    expect(seedAgentMirrorMock).not.toHaveBeenCalled();
  });

  it('ignores a snapshot for an agent it does not know', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.snapshot, snapshot('agent-8', 0));
    expect(seedAgentMirrorMock).not.toHaveBeenCalled();
  });
});

describe('output — nothing twice, nothing lost at the seam', () => {
  it('holds live batches back until the agent has its screen', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));

    output(batch('agent-1', 'early', 105));
    nextFrame();

    expect(logOf('agent-1')).toEqual([]);
  });

  it('applies only the buffered batches the snapshot does not already hold', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    output(batch('agent-1', 'one', 103));
    output(batch('agent-1', 'two', 106));
    output(batch('agent-1', 'three', 111));

    receive(hostEvents.snapshot, snapshot('agent-1', 106));

    expect(logOf('agent-1')).toEqual(['three']);
  });

  it('seeds the mirror before it writes the batches that come after the snapshot', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    output(batch('agent-1', 'after', 111));
    let logAtSeed: string[] | null = null;
    seedAgentMirrorMock.mockImplementation(() => void (logAtSeed = logOf('agent-1')));

    receive(hostEvents.snapshot, snapshot('agent-1', 106));

    expect(logAtSeed).toEqual([]);
    expect(logOf('agent-1')).toEqual(['after']);
  });

  it('writes live batches straight through once the agent is synced, in order', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    output(batch('agent-1', 'buffered', 111));
    receive(hostEvents.snapshot, snapshot('agent-1', 106));

    output(batch('agent-1', 'live-1', 117));
    output(batch('agent-1', 'live-2', 123));
    nextFrame();

    expect(logOf('agent-1')).toEqual(['buffered', 'live-1', 'live-2']);
  });

  it('needs no snapshot for an agent whose first batch starts at offset 0', () => {
    output(batch('agent-5', 'hello\r\n', 7));
    output(batch('agent-5', '✓ ok', 13));
    nextFrame();
    expect(logOf('agent-5')).toEqual(['hello\r\n', '✓ ok']);

    receive(hostEvents.roster, roster('agent-5'));
    expect(requested()).toEqual([]);
    expect(logOf('agent-5')).toEqual(['hello\r\n', '✓ ok']);
  });

  it('ignores a snapshot that arrives for an agent already synced from offset 0', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    output(batch('agent-1', 'hello', 5));
    nextFrame();

    receive(hostEvents.snapshot, snapshot('agent-1', 5));

    expect(seedAgentMirrorMock).not.toHaveBeenCalled();
    expect(logOf('agent-1')).toEqual(['hello']);
  });

  it('drops output that breaks the contract instead of guessing its offset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    output({ agentId: 'agent-1', stream: 'stdout', line: 'x', timestamp: 1 });
    nextFrame();

    expect(logOf('agent-1')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentOutput.endOffset'));
    warn.mockRestore();
  });

  it('hands over what its batcher still holds on uninstall', () => {
    output(batch('agent-5', 'tail', 4));
    uninstall?.();
    uninstall = null;
    expect(logOf('agent-5')).toEqual(['tail']);
  });
});

describe('one writer per field', () => {
  it('derives nothing about an agent from its output: the roster’s agents stay as sent', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.snapshot, snapshot('agent-1', 0));
    const before = useStore.getState();

    output(batch('agent-1', 'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n', 60));
    nextFrame();

    const after = useStore.getState();
    expect(logOf('agent-1')).toHaveLength(1);
    expect(after.agents).toBe(before.agents);
    expect(after.agentEvents).toBe(before.agentEvents);
    expect(after.agentStreamLines).toBe(before.agentStreamLines);
    expect(after.agentHeartbeat).toBe(before.agentHeartbeat);
  });

  it('does not listen to agent-status: the roster is the status', () => {
    expect(onAgentStatusMock).not.toHaveBeenCalled();
  });
});

describe('sendAgentWindowAction', () => {
  it('sends the action to the main window', async () => {
    await sendAgentWindowAction({ kind: 'kill', agentId: 'agent-1' });
    expect(sent(clientEvents.action)).toEqual([{ kind: 'kill', agentId: 'agent-1' }]);
  });
});

describe('an empty window fills up again', () => {
  it('shows the first agent that appears after an empty welcome', () => {
    receive(hostEvents.welcome, welcome([]));
    expect(useStore.getState().agentWindowActiveAgentId).toBeNull();

    receive(hostEvents.roster, roster('agent-1'));

    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-1');
  });

  it('shows a new agent after the last one was dismissed', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.roster, roster());

    receive(hostEvents.roster, roster('agent-2'));

    expect(useStore.getState().agentWindowActiveAgentId).toBe('agent-2');
  });
});

describe('snapshots — an unanswered request does not block the rest', () => {
  const timeout = () => vi.advanceTimersByTime(fixtures.snapshotTimeoutMs);

  it('moves on after the timeout and comes back to the agent behind the others', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2', 'agent-3']));
    expect(requested()).toEqual(['agent-1']);

    timeout();
    expect(requested()).toEqual(['agent-1', 'agent-2']);

    receive(hostEvents.snapshot, snapshot('agent-2', 0));
    expect(requested()).toEqual(['agent-1', 'agent-2', 'agent-3']);

    receive(hostEvents.snapshot, snapshot('agent-3', 0));
    expect(requested()).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-1']);
  });

  it('does not wait out a timeout that an answer already settled', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    receive(hostEvents.snapshot, snapshot('agent-1', 0));
    receive(hostEvents.snapshot, snapshot('agent-2', 0));
    sendToWindowMock.mockClear();

    timeout();

    expect(requested()).toEqual([]);
  });

  it('counts an answer that breaks the contract as no answer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));

    receive(hostEvents.snapshot, { ...snapshot('agent-1', 0), endOffset: -1 });
    expect(requested()).toEqual(['agent-1']);
    expect(seedAgentMirrorMock).not.toHaveBeenCalled();

    timeout();
    expect(requested()).toEqual(['agent-1', 'agent-2']);
    warn.mockRestore();
  });

  it('still takes an answer that comes after its timeout', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    timeout();

    receive(hostEvents.snapshot, snapshot('agent-1', 0, 'LATE'));

    expect(seedAgentMirrorMock).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ data: 'LATE' })
    );
  });

  it('keeps asking for a lone agent whose answer never comes', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    timeout();
    timeout();
    expect(requested()).toEqual(['agent-1', 'agent-1', 'agent-1']);
  });

  it('stops asking on uninstall', () => {
    receive(hostEvents.welcome, welcome(['agent-1', 'agent-2']));
    uninstall?.();
    uninstall = null;
    sendToWindowMock.mockClear();

    timeout();

    expect(requested()).toEqual([]);
  });
});

describe('output — a bounded wait for the snapshot', () => {
  it('buffers nothing for an agent that left the roster', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    receive(hostEvents.roster, roster());
    output(batch('agent-1', 'into the void', 113));

    // Back on the roster: only what came after counts as buffered.
    receive(hostEvents.roster, roster('agent-1'));
    receive(hostEvents.snapshot, snapshot('agent-1', 0));

    expect(logOf('agent-1')).toEqual([]);
  });

  it('asks for a fresh snapshot when the wait outgrows the buffer, and refuses the old one', () => {
    receive(hostEvents.welcome, welcome(['agent-1']));
    expect(requested()).toEqual(['agent-1']);

    const flood = 'x'.repeat(MAX_AGENT_LOG_BYTES + 1);
    output(batch('agent-1', flood, 100 + flood.length));
    expect(requested()).toEqual(['agent-1', 'agent-1']);

    // The answer to the first request was taken before the flood.
    receive(hostEvents.snapshot, snapshot('agent-1', 100, 'BEFORE THE FLOOD'));
    expect(seedAgentMirrorMock).not.toHaveBeenCalled();

    output(batch('agent-1', 'after', 100 + flood.length + 5));
    receive(hostEvents.snapshot, snapshot('agent-1', 100 + flood.length, 'COVERS IT'));

    expect(seedAgentMirrorMock).toHaveBeenCalledTimes(1);
    expect(logOf('agent-1')).toEqual(['after']);
  });
});
