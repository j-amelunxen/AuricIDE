import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import fixtures from './agentWindow.fixtures.json';

const { hostEvents, clientEvents } = fixtures;

// Which message goes where is what matters here; the subscription mechanics
// have their own tests. `onListening` is held back so a test decides when a
// listener is in place.
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Handler>();
const listening = new Map<string, () => void>();
const stopped: string[] = [];
let windowState: Handler | null = null;
const sendToWindowMock = vi.fn(async (..._args: unknown[]) => undefined);
const focusAgentWindowMock = vi.fn(async () => undefined);
vi.mock('@/lib/tauri/agentWindow', async (original) => ({
  ...(await original<typeof import('@/lib/tauri/agentWindow')>()),
  sendToWindow: (...args: unknown[]) => sendToWindowMock(...args),
  focusAgentWindow: () => focusAgentWindowMock(),
  onWindowMessage: (name: string, handler: Handler, onListening?: () => void) => {
    listeners.set(name, handler);
    if (onListening) listening.set(name, onListening);
    return () => void stopped.push(name);
  },
  onAgentWindowState: (handler: Handler) => {
    windowState = handler;
    return () => void stopped.push('window-state');
  },
}));

const uninstallResizeSync = vi.fn();
const installPtyResizeSyncMock = vi.fn(() => uninstallResizeSync);
vi.mock('@/lib/tauri/terminal', () => ({ installPtyResizeSync: () => installPtyResizeSyncMock() }));

const flushAgentOutputMock = vi.fn();
const agentOutputOffsetMock = vi.fn((_agentId: string) => 0);
vi.mock('@/lib/hooks/useAgentEvents', () => ({
  flushAgentOutput: () => flushAgentOutputMock(),
  agentOutputOffset: (agentId: string) => agentOutputOffsetMock(agentId),
}));

const snapshotAgentScreenMock = vi.fn(
  (_agentId: string): Promise<{ data: string; seq: number }> | null => null
);
const agentMirrorSizeMock = vi.fn((_agentId: string) => ({ rows: 24, cols: 80 }));
vi.mock('@/lib/terminal/agentMirror', () => ({
  snapshotAgentScreen: (agentId: string) => snapshotAgentScreenMock(agentId),
  agentMirrorSize: (agentId: string) => agentMirrorSizeMock(agentId),
}));

const { useStore } = await import('@/lib/store');
const { installAgentWindowHost, setAgentWindowHandover, showAgentInWindow } =
  await import('./agentWindowHost');

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

function handlers() {
  return { onKill: vi.fn(), onDismiss: vi.fn(), onSaveScratch: vi.fn(), onDock: vi.fn() };
}

/** Messages sent to the agent window under one event name, payloads only. */
const sent = (event: string) =>
  sendToWindowMock.mock.calls
    .filter(([label, name]) => label === fixtures.windows.agents && name === event)
    .map(([, , payload]) => payload);

const receive = (event: string, payload?: unknown) => listeners.get(event)?.(payload);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  listening.clear();
  stopped.length = 0;
  windowState = null;
  agentOutputOffsetMock.mockImplementation(() => 0);
  snapshotAgentScreenMock.mockImplementation(() => null);
  agentMirrorSizeMock.mockImplementation(() => ({ rows: 24, cols: 80 }));
  useStore.setState({ agents: [], agentLogs: {}, agentLogMeta: {}, agentWindowOpen: false });
  setAgentWindowHandover({ activeAgentId: null, gridCells: null });
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

describe('installAgentWindowHost — announcing itself', () => {
  it('says host-ready only once every listener it answers with is in place', () => {
    uninstall = installAgentWindowHost(handlers());

    listening.get(clientEvents.hello)?.();
    listening.get(clientEvents.snapshotRequest)?.();
    expect(sent(hostEvents.hostReady)).toHaveLength(0);

    listening.get(clientEvents.action)?.();
    expect(sent(hostEvents.hostReady)).toHaveLength(1);
  });

  it('follows the window state Rust reports', () => {
    uninstall = installAgentWindowHost(handlers());

    windowState?.({ open: true });
    expect(useStore.getState().agentWindowOpen).toBe(true);
    windowState?.({ open: false });
    expect(useStore.getState().agentWindowOpen).toBe(false);
  });

  it('leaves PTY geometry alone while there is only one window', () => {
    uninstall = installAgentWindowHost(handlers());
    expect(installPtyResizeSyncMock).not.toHaveBeenCalled();
  });

  it('follows PTY geometry across windows exactly as long as the agent window is open', () => {
    uninstall = installAgentWindowHost(handlers());

    windowState?.({ open: true });
    expect(installPtyResizeSyncMock).toHaveBeenCalledTimes(1);
    expect(uninstallResizeSync).not.toHaveBeenCalled();

    windowState?.({ open: false });
    expect(uninstallResizeSync).toHaveBeenCalledTimes(1);

    windowState?.({ open: true });
    expect(installPtyResizeSyncMock).toHaveBeenCalledTimes(2);
  });

  it('picks the geometry up when it is installed with the window already open', () => {
    useStore.setState({ agentWindowOpen: true });
    uninstall = installAgentWindowHost(handlers());
    expect(installPtyResizeSyncMock).toHaveBeenCalledTimes(1);
  });

  it('stops everything on uninstall', () => {
    const stop = installAgentWindowHost(handlers());
    windowState?.({ open: true });

    stop();

    expect(uninstallResizeSync).toHaveBeenCalledTimes(1);
    expect(stopped.sort()).toEqual(
      [clientEvents.action, clientEvents.hello, clientEvents.snapshotRequest, 'window-state'].sort()
    );
  });
});

describe('hello → welcome', () => {
  it('answers with the roster and the handover the pop-out left', () => {
    const agents = [agent('agent-1'), agent('agent-2')];
    useStore.setState({ agents });
    uninstall = installAgentWindowHost(handlers());
    setAgentWindowHandover({
      activeAgentId: 'agent-2',
      gridCells: ['agent-1', 'agent-2', 'agent-1', 'agent-2'],
    });

    receive(clientEvents.hello);

    expect(sent(hostEvents.welcome)).toEqual([
      {
        agents,
        errorDigests: {},
        activeAgentId: 'agent-2',
        gridCells: ['agent-1', 'agent-2', 'agent-1', 'agent-2'],
      },
    ]);
  });

  it('hands a layout over once: the next hello gets the roster alone', () => {
    uninstall = installAgentWindowHost(handlers());
    setAgentWindowHandover({ activeAgentId: 'agent-1', gridCells: null });

    receive(clientEvents.hello);
    receive(clientEvents.hello);

    expect(sent(hostEvents.welcome)[1]).toMatchObject({ activeAgentId: null, gridCells: null });
  });

  it('takes a hello as proof the window is there', () => {
    uninstall = installAgentWindowHost(handlers());
    receive(clientEvents.hello);
    expect(useStore.getState().agentWindowOpen).toBe(true);
  });

  it('derives a failed agent’s digest where the full log is', () => {
    useStore.setState({
      agents: [agent('agent-1'), agent('agent-2', { status: 'error' })],
      agentLogs: {
        'agent-1': ['error: not this one, it is still running\r\n'],
        'agent-2': ['running the suite\r\n', 'exit code 1: suite failed\r\n'],
      },
    });
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.hello);

    expect(sent(hostEvents.welcome)[0]).toMatchObject({
      errorDigests: { 'agent-2': 'exit code 1: suite failed' },
    });
  });
});

describe('snapshot-request → snapshot', () => {
  it('sends the mirror’s screen with its geometry and the offset it reaches', async () => {
    snapshotAgentScreenMock.mockImplementation(() => Promise.resolve({ data: 'SCREEN', seq: 9 }));
    agentMirrorSizeMock.mockImplementation(() => ({ rows: 50, cols: 160 }));
    agentOutputOffsetMock.mockImplementation(() => 4096);
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-1' });
    await settle();

    expect(sent(hostEvents.snapshot)).toEqual([
      { agentId: 'agent-1', data: 'SCREEN', rows: 50, cols: 160, endOffset: 4096 },
    ]);
  });

  it('flushes pending output first, so the screen reaches the offset it names', async () => {
    // A batch is parked for the next frame: the offset already counts it, the
    // store and the mirror do not hold it yet. Flushing is what closes that gap.
    const order: string[] = [];
    let mirrorHolds = 'up to 10';
    flushAgentOutputMock.mockImplementation(() => {
      order.push('flush');
      mirrorHolds = 'up to 25';
    });
    agentOutputOffsetMock.mockImplementation(() => 25);
    snapshotAgentScreenMock.mockImplementation(() => {
      order.push('snapshot');
      return Promise.resolve({ data: mirrorHolds, seq: 1 });
    });
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-1' });
    await settle();

    expect(order).toEqual(['flush', 'snapshot']);
    expect(sent(hostEvents.snapshot)[0]).toMatchObject({ data: 'up to 25', endOffset: 25 });
  });

  it('names the offset of the moment the screen was taken, not of when it was ready', async () => {
    let offset = 100;
    agentOutputOffsetMock.mockImplementation(() => offset);
    let ready: (screen: { data: string; seq: number }) => void = () => {};
    snapshotAgentScreenMock.mockImplementation(
      () => new Promise((resolve) => void (ready = resolve))
    );
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-1' });
    // The agent prints on while the mirror finishes parsing.
    offset = 180;
    ready({ data: 'up to 100', seq: 4 });
    await settle();

    expect(sent(hostEvents.snapshot)[0]).toMatchObject({ data: 'up to 100', endOffset: 100 });
  });

  it('answers for an agent that never printed: empty screen, default size, current offset', async () => {
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-3' });
    await settle();

    expect(sent(hostEvents.snapshot)).toEqual([
      { agentId: 'agent-3', data: '', ...fixtures.defaultPtySize, endOffset: 0 },
    ]);
  });

  it('answers with a blank screen when serializing throws, rather than not at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshotAgentScreenMock.mockImplementation(() => {
      throw new Error('serializer broke');
    });
    agentMirrorSizeMock.mockImplementation(() => ({ rows: 50, cols: 160 }));
    agentOutputOffsetMock.mockImplementation(() => 4096);
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-1' });
    await settle();

    expect(sent(hostEvents.snapshot)).toEqual([
      { agentId: 'agent-1', data: '', rows: 50, cols: 160, endOffset: 4096 },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('serializer broke'));
    warn.mockRestore();
  });

  it('answers with a blank screen when the screen never settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    snapshotAgentScreenMock.mockImplementation(() => Promise.reject(new Error('disposed')));
    agentOutputOffsetMock.mockImplementation(() => 12);
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: 'agent-1' });
    await settle();

    expect(sent(hostEvents.snapshot)).toEqual([
      { agentId: 'agent-1', data: '', ...fixtures.defaultPtySize, endOffset: 12 },
    ]);
    warn.mockRestore();
  });

  it('drops a request that breaks the contract', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    uninstall = installAgentWindowHost(handlers());

    receive(clientEvents.snapshotRequest, { agentId: '' });
    await settle();

    expect(sent(hostEvents.snapshot)).toHaveLength(0);
    expect(flushAgentOutputMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('snapshotRequest.agentId'));
    warn.mockRestore();
  });
});

describe('roster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('publishes when the agents change, at most once per throttle window, with the latest', () => {
    uninstall = installAgentWindowHost(handlers());
    useStore.setState({ agentWindowOpen: true });

    useStore.setState({ agents: [agent('agent-1')] });
    useStore.setState({ agents: [agent('agent-1'), agent('agent-2')] });
    expect(sent(hostEvents.roster)).toHaveLength(0);

    vi.advanceTimersByTime(fixtures.rosterThrottleMs);

    expect(sent(hostEvents.roster)).toHaveLength(1);
    expect(sent(hostEvents.roster)[0]).toMatchObject({
      agents: [{ id: 'agent-1' }, { id: 'agent-2' }],
      errorDigests: {},
    });

    useStore.setState({ agents: [agent('agent-2')] });
    vi.advanceTimersByTime(fixtures.rosterThrottleMs);
    expect(sent(hostEvents.roster)).toHaveLength(2);
  });

  it('says nothing while no agent window is open', () => {
    uninstall = installAgentWindowHost(handlers());

    useStore.setState({ agents: [agent('agent-1')] });
    vi.advanceTimersByTime(fixtures.rosterThrottleMs * 2);

    expect(sent(hostEvents.roster)).toHaveLength(0);
  });

  it('does not publish for store changes that leave the agents alone', () => {
    uninstall = installAgentWindowHost(handlers());
    useStore.setState({ agentWindowOpen: true });
    vi.advanceTimersByTime(fixtures.rosterThrottleMs);
    sendToWindowMock.mockClear();

    useStore.setState({ selectedAgentId: 'agent-1' });
    vi.advanceTimersByTime(fixtures.rosterThrottleMs * 2);

    expect(sent(hostEvents.roster)).toHaveLength(0);
  });

  it('stops publishing on uninstall, a pending one included', () => {
    const stop = installAgentWindowHost(handlers());
    useStore.setState({ agentWindowOpen: true });
    useStore.setState({ agents: [agent('agent-1')] });

    stop();
    vi.advanceTimersByTime(fixtures.rosterThrottleMs * 2);

    expect(sent(hostEvents.roster)).toHaveLength(0);
  });
});

describe('action', () => {
  it('routes each action to its handler', () => {
    const h = handlers();
    uninstall = installAgentWindowHost(h);

    for (const { raw } of fixtures.messages.action) receive(clientEvents.action, raw);

    expect(h.onKill).toHaveBeenCalledWith('agent-1');
    expect(h.onDismiss).toHaveBeenCalledWith('agent-2');
    expect(h.onSaveScratch).toHaveBeenCalledWith('Fix the parser', '$ ls\nsrc\n');
    expect(h.onDock.mock.calls).toEqual([
      ['agent-1', ['agent-1', 'agent-2', 'agent-1', 'agent-2']],
      [null, null],
    ]);
  });

  it('never carries out an action that breaks the contract', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = handlers();
    uninstall = installAgentWindowHost(h);

    receive(clientEvents.action, { kind: 'spawn', agentId: 'agent-1' });
    receive(clientEvents.action, { kind: 'kill' });
    receive(clientEvents.action, { kind: 'kill', agentId: '' });

    for (const handler of Object.values(h)) expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent window: action.'));
    warn.mockRestore();
  });

  it('reports a handler that fails instead of leaving a rejection behind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = handlers();
    h.onKill.mockRejectedValue(new Error('agent already gone'));
    uninstall = installAgentWindowHost(h);

    receive(clientEvents.action, { kind: 'kill', agentId: 'agent-1' });
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agent already gone'));
    warn.mockRestore();
  });
});

describe('showAgentInWindow', () => {
  it('shows the agent and brings the window forward', async () => {
    await expect(showAgentInWindow('agent-2')).resolves.toBe(true);

    expect(sent(hostEvents.show)).toEqual([{ agentId: 'agent-2' }]);
    expect(focusAgentWindowMock).toHaveBeenCalledTimes(1);
  });

  it('sends the roster ahead, so the window knows an agent that was only just started', async () => {
    useStore.setState({ agents: [agent('agent-9')] });

    await showAgentInWindow('agent-9');

    const names = sendToWindowMock.mock.calls.map(([, name]) => name);
    expect(names).toEqual([hostEvents.roster, hostEvents.show]);
    expect(sent(hostEvents.roster)[0]).toMatchObject({ agents: [{ id: 'agent-9' }] });
  });
});

describe('showAgentInWindow — the window is gone', () => {
  it('says so and stops claiming the window is open, so the caller can fall back', async () => {
    useStore.setState({ agentWindowOpen: true });
    focusAgentWindowMock.mockRejectedValueOnce(new Error('window not found'));

    await expect(showAgentInWindow('agent-2')).resolves.toBe(false);

    expect(useStore.getState().agentWindowOpen).toBe(false);
  });
});
