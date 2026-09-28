import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { resetRemovedAgents } from '../store/agent/removedAgents';
import { Terminal } from '@xterm/headless';
import {
  agentMirrorIsLive,
  agentMirrorResized,
  disposeAllAgentMirrors,
  MIRROR_PARSE_BYTES,
  onAgentPtyResize,
  resizeAgentMirror,
  snapshotAgentScreen,
} from './agentMirror';

describe('agent PTY resize propagation', () => {
  beforeEach(() => {
    disposeAllAgentMirrors();
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('notifies listeners when the PTY size changes', () => {
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a1', 40, 160);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ rows: 40, cols: 160 });
  });

  it('does not notify when the size is unchanged', () => {
    const listener = vi.fn();
    resizeAgentMirror('a1', 40, 160);
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a1', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify listeners of other agents', () => {
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a2', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onAgentPtyResize('a1', listener);
    unsubscribe();

    resizeAgentMirror('a1', 40, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('agentMirrorResized is false for a mirror that never changed size', () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    expect(agentMirrorResized('a1')).toBe(false);
  });

  it('agentMirrorResized is true once the mirror was resized after output existed', () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    resizeAgentMirror('a1', 40, 160);
    expect(agentMirrorResized('a1')).toBe(true);
  });

  it('agentMirrorResized stays false when the size was set before any output', () => {
    resizeAgentMirror('a1', 40, 160);
    useStore.getState().appendAgentLog('a1', 'hello');
    // All chunks were produced at a single geometry — raw replay is faithful.
    expect(agentMirrorResized('a1')).toBe(false);
  });
});

describe('deferred mirror parsing', () => {
  beforeEach(() => {
    disposeAllAgentMirrors();
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
    vi.restoreAllMocks();
  });

  it('does not parse each chunk as it arrives', () => {
    const write = vi.spyOn(Terminal.prototype, 'write');
    for (let i = 0; i < 100; i++) useStore.getState().appendAgentLog('a1', `line ${i}\r\n`);
    expect(write).not.toHaveBeenCalled();
  });

  it('parses everything queued, in one write, when the screen is asked for', async () => {
    const write = vi.spyOn(Terminal.prototype, 'write');
    for (let i = 0; i < 100; i++) useStore.getState().appendAgentLog('a1', `line ${i}\r\n`);
    const snapshot = await snapshotAgentScreen('a1');
    // one data write plus the empty write that marks the snapshot point
    expect(write.mock.calls.filter(([data]) => data !== '')).toHaveLength(1);
    expect(snapshot?.seq).toBe(100);
    expect(snapshot?.data).toContain('line 99');
  });

  it('parses once the queue passes the byte budget, so it never grows unbounded', () => {
    const write = vi.spyOn(Terminal.prototype, 'write');
    const chunk = 'x'.repeat(16 * 1024);
    for (let i = 0; i < MIRROR_PARSE_BYTES / chunk.length; i++) {
      useStore.getState().appendAgentLog('a1', chunk);
    }
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('frozen mirrors of finished agents', () => {
  const agent = (status: 'running' | 'idle' | 'error') =>
    ({ id: 'a1', name: 'A', model: 'm', provider: 'claude', status, startedAt: 0 }) as const;

  beforeEach(() => {
    disposeAllAgentMirrors();
    resetRemovedAgents();
    useStore.setState({ agentLogs: {}, agentLogMeta: {}, agents: [agent('running')] });
  });

  async function finishAndFreeze() {
    useStore.setState({ agents: [agent('idle')] });
    await vi.waitFor(() => expect(agentMirrorIsLive('a1')).toBe(false));
  }

  it('releases the terminal once the agent finishes, answering snapshots unchanged', async () => {
    for (let i = 0; i < 50; i++)
      useStore.getState().appendAgentLog('a1', `\x1b[1mline ${i}\x1b[0m\r\n`);
    const before = await snapshotAgentScreen('a1');

    await finishAndFreeze();

    expect(await snapshotAgentScreen('a1')).toEqual(before);
  });

  it('keeps the terminal while the agent runs', async () => {
    useStore.getState().appendAgentLog('a1', 'working\r\n');
    await snapshotAgentScreen('a1');
    useStore.setState({ agents: [agent('running')] });
    expect(agentMirrorIsLive('a1')).toBe(true);
  });

  it('thaws for output that arrives after the finish, keeping what it had', async () => {
    useStore.getState().appendAgentLog('a1', 'before\r\n');
    await finishAndFreeze();

    useStore.getState().appendAgentLog('a1', 'after\r\n');
    const snapshot = await snapshotAgentScreen('a1');

    expect(snapshot?.data).toContain('before');
    expect(snapshot?.data).toContain('after');
    expect(snapshot?.seq).toBe(2);
  });

  it('is dropped entirely when the finished agent is dismissed', async () => {
    useStore.getState().appendAgentLog('a1', 'bye\r\n');
    await finishAndFreeze();

    useStore.getState().dismissFinishedAgent('a1');

    expect(snapshotAgentScreen('a1')).toBeNull();
  });

  it('thaws to take a resize, which then counts as one', async () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    await finishAndFreeze();

    resizeAgentMirror('a1', 40, 160);

    expect(agentMirrorIsLive('a1')).toBe(true);
    expect(agentMirrorResized('a1')).toBe(true);
    expect((await snapshotAgentScreen('a1'))?.data).toContain('hello');
  });
});
