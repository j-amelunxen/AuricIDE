import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { resetRemovedAgents } from '../store/agent/removedAgents';
import { Terminal } from '@xterm/headless';
import {
  agentMirrorIsLive,
  agentMirrorResized,
  agentMirrorSize,
  disposeAllAgentMirrors,
  MIRROR_PARSE_BYTES,
  onAgentPtyResize,
  resizeAgentMirror,
  seedAgentMirror,
  snapshotAgentScreen,
} from './agentMirror';
import { attachAgentStream } from './agentStream';

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

describe('agentMirrorSize', () => {
  beforeEach(() => {
    disposeAllAgentMirrors();
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('is the size every agent PTY opens at while nothing else is known', () => {
    expect(agentMirrorSize('a1')).toEqual({ rows: 24, cols: 80 });
  });

  it('is a size reported before the agent printed anything', () => {
    resizeAgentMirror('a1', 40, 160);
    expect(agentMirrorSize('a1')).toEqual({ rows: 40, cols: 160 });
  });

  it('follows the mirror once there is one', () => {
    useStore.getState().appendAgentLog('a1', 'hello');
    expect(agentMirrorSize('a1')).toEqual({ rows: 24, cols: 80 });
    resizeAgentMirror('a1', 50, 120);
    expect(agentMirrorSize('a1')).toEqual({ rows: 50, cols: 120 });
  });
});

describe('a mirror seeded from another window’s snapshot', () => {
  const agent = (status: 'running' | 'idle') =>
    ({ id: 'a1', name: 'A', model: 'm', provider: 'claude', status, startedAt: 0 }) as const;
  const SCREEN = '\x1b[1mscreen so far\x1b[0m\r\n';

  beforeEach(() => {
    disposeAllAgentMirrors();
    resetRemovedAgents();
    useStore.setState({ agentLogs: {}, agentLogMeta: {}, agents: [agent('running')] });
    vi.restoreAllMocks();
  });

  /** Everything a view wrote, as one string. */
  function recorder() {
    const writes: string[] = [];
    return { term: { write: (data: string) => void writes.push(data) }, writes };
  }
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  it('creates the mirror at the snapshot’s geometry, holding its screen', async () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 50, cols: 160 });

    expect(agentMirrorSize('a1')).toEqual({ rows: 50, cols: 160 });
    const snapshot = await snapshotAgentScreen('a1');
    expect(snapshot?.data).toContain('screen so far');
    expect(snapshot?.seq).toBe(0);
  });

  it('sends a view down the snapshot path, as a resized mirror does', () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    expect(agentMirrorResized('a1')).toBe(true);
  });

  it('seed, then live chunks: a late view gets the picture and each chunk once', async () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    useStore.getState().appendAgentTerminalChunks('a1', ['live-1\r\n', 'live-2\r\n']);

    expect((await snapshotAgentScreen('a1'))?.seq).toBe(2);

    const { term, writes } = recorder();
    const handle = attachAgentStream(term, 'a1');
    await handle.restored;
    useStore.getState().appendAgentTerminalChunks('a1', ['live-3\r\n']);

    const drawn = writes.join('');
    expect(count(drawn, 'screen so far')).toBe(1);
    expect(count(drawn, 'live-1')).toBe(1);
    expect(count(drawn, 'live-2')).toBe(1);
    expect(count(drawn, 'live-3')).toBe(1);
    // The picture came first, as one write, and already held the two chunks.
    expect(writes[0]).toContain('screen so far');
    expect(writes[0]).toContain('live-2');
    handle.detach();
  });

  it('a chunk landing while the view’s snapshot settles is drawn once', async () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    const { term, writes } = recorder();
    const handle = attachAgentStream(term, 'a1');
    useStore.getState().appendAgentTerminalChunks('a1', ['racing\r\n']);
    await handle.restored;

    expect(count(writes.join(''), 'racing')).toBe(1);
    expect(count(writes.join(''), 'screen so far')).toBe(1);
    handle.detach();
  });

  it('replaces what the mirror held and counts the store’s chunks as covered', async () => {
    useStore.getState().appendAgentTerminalChunks('a1', ['stale words\r\n']);

    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    useStore.getState().appendAgentTerminalChunks('a1', ['fresh\r\n']);

    const snapshot = await snapshotAgentScreen('a1');
    expect(snapshot?.data).not.toContain('stale words');
    expect(snapshot?.data).toContain('screen so far');
    expect(count(snapshot?.data ?? '', 'fresh')).toBe(1);
    expect(snapshot?.seq).toBe(2);
  });

  it('survives other agents’ output although it has no log of its own', async () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    useStore.getState().appendAgentTerminalChunks('a2', ['someone else\r\n']);

    expect((await snapshotAgentScreen('a1'))?.data).toContain('screen so far');
  });

  it('goes with its log once it had one', () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    useStore.getState().appendAgentTerminalChunks('a1', ['x']);
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });

    expect(snapshotAgentScreen('a1')).toBeNull();
  });

  it('returns to the size the PTY is known to have, after the snapshot is written', async () => {
    resizeAgentMirror('a1', 30, 100);
    const resize = vi.spyOn(Terminal.prototype, 'resize');

    seedAgentMirror('a1', { data: SCREEN, rows: 50, cols: 160 });

    // Not yet: the snapshot has to be laid out at the width it was made for.
    expect(resize).not.toHaveBeenCalled();
    const snapshot = await snapshotAgentScreen('a1');
    expect(resize).toHaveBeenCalledWith(100, 30);
    expect(agentMirrorSize('a1')).toEqual({ rows: 30, cols: 100 });
    expect(snapshot?.data).toContain('screen so far');
  });

  it('takes a resize that arrives while the snapshot is still being written', async () => {
    const resize = vi.spyOn(Terminal.prototype, 'resize');
    seedAgentMirror('a1', { data: SCREEN, rows: 50, cols: 160 });

    resizeAgentMirror('a1', 30, 100);

    expect(resize).not.toHaveBeenCalled();
    await snapshotAgentScreen('a1');
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(100, 30);
  });

  it('adopts the snapshot’s size as the PTY’s when none was known', () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 50, cols: 160 });
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    resizeAgentMirror('a1', 50, 160);

    expect(listener).not.toHaveBeenCalled();
  });

  it('tells attached views to redraw even when the geometry did not change', () => {
    resizeAgentMirror('a1', 24, 80);
    const listener = vi.fn();
    onAgentPtyResize('a1', listener);

    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ rows: 24, cols: 80, seeded: true });
  });

  it('freezes like any other mirror when its agent is finished', async () => {
    seedAgentMirror('a1', { data: SCREEN, rows: 24, cols: 80 });
    useStore.setState({ agents: [agent('idle')] });
    await vi.waitFor(() => expect(agentMirrorIsLive('a1')).toBe(false));

    expect((await snapshotAgentScreen('a1'))?.data).toContain('screen so far');
    expect(agentMirrorResized('a1')).toBe(true);
  });
});
