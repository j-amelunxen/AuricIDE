import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { attachAgentStream } from './agentStream';

/** Most tests here only care about the detach function. */
function attachAgentStreamDetach(...args: Parameters<typeof attachAgentStream>) {
  return attachAgentStream(...args).detach;
}

describe('attachAgentStream', () => {
  beforeEach(() => {
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('replays retained history as a single write', () => {
    useStore.getState().appendAgentLog('a1', 'one');
    useStore.getState().appendAgentLog('a1', 'two');

    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('onetwo');
    detach();
  });

  it('writes nothing on attach when there is no history', () => {
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');
    expect(write).not.toHaveBeenCalled();
    detach();
  });

  it('writes each new chunk exactly once after attach', () => {
    useStore.getState().appendAgentLog('a1', 'old');
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');
    write.mockClear();

    useStore.getState().appendAgentLog('a1', 'live-1');
    useStore.getState().appendAgentLog('a1', 'live-2');

    expect(write.mock.calls.map((c) => c[0]).join('')).toBe('live-1live-2');
    detach();
  });

  it('ignores chunks of other agents', () => {
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');

    useStore.getState().appendAgentLog('a2', 'noise');

    expect(write).not.toHaveBeenCalled();
    detach();
  });

  it('stops writing after detach', () => {
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');
    detach();

    useStore.getState().appendAgentLog('a1', 'late');

    expect(write).not.toHaveBeenCalled();
  });

  it('writes only the retained tail when trimming outpaced the cursor', () => {
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');

    // Simulate several appends collapsed into one notification, with the
    // byte cap having already trimmed the oldest chunks away.
    useStore.setState({
      agentLogs: { a1: ['tail-1', 'tail-2'] },
      agentLogMeta: { a1: { seq: 10, bytes: 12 } },
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('tail-1tail-2');
    detach();
  });

  it('unrelated store updates do not trigger writes', () => {
    useStore.getState().appendAgentLog('a1', 'history');
    const write = vi.fn();
    const detach = attachAgentStreamDetach({ write }, 'a1');
    write.mockClear();

    useStore.setState({ selectedAgentId: 'a1' });

    expect(write).not.toHaveBeenCalled();
    detach();
  });
});

describe('attachAgentStream restore signal', () => {
  beforeEach(() => {
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('resolves restored immediately when history is replayed directly', async () => {
    useStore.getState().appendAgentLog('a1', 'one');
    const write = vi.fn();
    const handle = attachAgentStream({ write }, 'a1');
    await expect(handle.restored).resolves.toBeUndefined();
    handle.detach();
  });

  it('resolves restored when there is nothing to restore', async () => {
    const handle = attachAgentStream({ write: vi.fn() }, 'a1');
    await expect(handle.restored).resolves.toBeUndefined();
    handle.detach();
  });

  it('resolves restored only once the snapshot has been written', async () => {
    // Force the snapshot path: seq ahead of retained history means trimming.
    useStore.getState().appendAgentLog('a1', 'kept');
    useStore.setState((s) => ({
      agentLogMeta: { ...s.agentLogMeta, a1: { ...s.agentLogMeta.a1, seq: 500 } },
    }));

    const write = vi.fn();
    const handle = attachAgentStream({ write }, 'a1');
    expect(write).not.toHaveBeenCalled();

    await handle.restored;
    expect(write).toHaveBeenCalled();
    handle.detach();
  });

  it('resolves restored even when detached before the snapshot lands', async () => {
    useStore.getState().appendAgentLog('a1', 'kept');
    useStore.setState((s) => ({
      agentLogMeta: { ...s.agentLogMeta, a1: { ...s.agentLogMeta.a1, seq: 500 } },
    }));

    const handle = attachAgentStream({ write: vi.fn() }, 'a1');
    handle.detach();
    await expect(handle.restored).resolves.toBeUndefined();
  });
});
