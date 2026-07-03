import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { attachAgentStream } from './agentStream';

describe('attachAgentStream', () => {
  beforeEach(() => {
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('replays retained history as a single write', () => {
    useStore.getState().appendAgentLog('a1', 'one');
    useStore.getState().appendAgentLog('a1', 'two');

    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('onetwo');
    detach();
  });

  it('writes nothing on attach when there is no history', () => {
    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');
    expect(write).not.toHaveBeenCalled();
    detach();
  });

  it('writes each new chunk exactly once after attach', () => {
    useStore.getState().appendAgentLog('a1', 'old');
    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');
    write.mockClear();

    useStore.getState().appendAgentLog('a1', 'live-1');
    useStore.getState().appendAgentLog('a1', 'live-2');

    expect(write.mock.calls.map((c) => c[0]).join('')).toBe('live-1live-2');
    detach();
  });

  it('ignores chunks of other agents', () => {
    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');

    useStore.getState().appendAgentLog('a2', 'noise');

    expect(write).not.toHaveBeenCalled();
    detach();
  });

  it('stops writing after detach', () => {
    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');
    detach();

    useStore.getState().appendAgentLog('a1', 'late');

    expect(write).not.toHaveBeenCalled();
  });

  it('writes only the retained tail when trimming outpaced the cursor', () => {
    const write = vi.fn();
    const detach = attachAgentStream({ write }, 'a1');

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
    const detach = attachAgentStream({ write }, 'a1');
    write.mockClear();

    useStore.setState({ selectedAgentId: 'a1' });

    expect(write).not.toHaveBeenCalled();
    detach();
  });
});
