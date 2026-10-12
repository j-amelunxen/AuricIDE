import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockOnAgentOutput = vi.fn();
const mockOnAgentStatus = vi.fn();

vi.mock('../tauri/agentEvents', () => ({
  onAgentOutput: (...args: unknown[]) => mockOnAgentOutput(...args),
  onAgentStatus: (...args: unknown[]) => mockOnAgentStatus(...args),
}));

import {
  agentOutputOffset,
  flushAgentOutput,
  useAgentEvents,
  useBatchedAgentEvents,
} from './useAgentEvents';

describe('useAgentEvents', () => {
  const mockUnsubOutput = vi.fn();
  const mockUnsubStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAgentOutput.mockReturnValue(mockUnsubOutput);
    mockOnAgentStatus.mockReturnValue(mockUnsubStatus);
  });

  it('sets up onAgentOutput listener with callback', () => {
    const onOutput = vi.fn();
    const onStatus = vi.fn();
    renderHook(() => useAgentEvents(onOutput, onStatus));
    expect(mockOnAgentOutput).toHaveBeenCalledWith(onOutput);
  });

  it('sets up onAgentStatus listener with callback', () => {
    const onOutput = vi.fn();
    const onStatus = vi.fn();
    renderHook(() => useAgentEvents(onOutput, onStatus));
    expect(mockOnAgentStatus).toHaveBeenCalledWith(onStatus);
  });

  it('cleans up both listeners on unmount', () => {
    const { unmount } = renderHook(() => useAgentEvents(vi.fn(), vi.fn()));
    unmount();
    expect(mockUnsubOutput).toHaveBeenCalled();
    expect(mockUnsubStatus).toHaveBeenCalled();
  });

  it('re-subscribes when callbacks change', () => {
    const onOutput1 = vi.fn();
    const onStatus1 = vi.fn();
    const onOutput2 = vi.fn();
    const onStatus2 = vi.fn();

    const { rerender } = renderHook(
      ({ onOutput, onStatus }) => useAgentEvents(onOutput, onStatus),
      { initialProps: { onOutput: onOutput1, onStatus: onStatus1 } }
    );

    expect(mockOnAgentOutput).toHaveBeenCalledWith(onOutput1);

    rerender({ onOutput: onOutput2, onStatus: onStatus2 });

    // Should have cleaned up old and set up new
    expect(mockUnsubOutput).toHaveBeenCalled();
    expect(mockUnsubStatus).toHaveBeenCalled();
    expect(mockOnAgentOutput).toHaveBeenCalledWith(onOutput2);
    expect(mockOnAgentStatus).toHaveBeenCalledWith(onStatus2);
  });
});

describe('useBatchedAgentEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAgentOutput.mockReturnValue(vi.fn());
    mockOnAgentStatus.mockReturnValue(vi.fn());
  });

  function listeners() {
    const output = mockOnAgentOutput.mock.calls[0][0] as (e: unknown) => void;
    const status = mockOnAgentStatus.mock.calls[0][0] as (e: unknown) => void;
    return { output, status };
  }

  it('holds output back instead of handing over one chunk per event', () => {
    const onBatch = vi.fn();
    renderHook(() => useBatchedAgentEvents(onBatch, vi.fn()));
    const { output } = listeners();
    output({ agentId: 'a', stream: 'stdout', line: 'one', timestamp: 0 });
    output({ agentId: 'a', stream: 'stdout', line: 'two', timestamp: 0 });
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('delivers pending output before the status event that follows it', () => {
    const calls: string[] = [];
    renderHook(() =>
      useBatchedAgentEvents(
        (batch) => calls.push(`batch:${JSON.stringify(batch.map(([id, chunks]) => [id, chunks]))}`),
        (event) => calls.push(`status:${(event as { status: string }).status}`)
      )
    );
    const { output, status } = listeners();
    output({ agentId: 'a', stream: 'stdout', line: 'Error: boom', timestamp: 0 });
    status({ agentId: 'a', status: 'error', exitCode: 1 });
    expect(calls).toEqual(['batch:[["a",["Error: boom"]]]', 'status:error']);
  });

  it('hands over what is pending when it unmounts', () => {
    const onBatch = vi.fn();
    const { unmount } = renderHook(() => useBatchedAgentEvents(onBatch, vi.fn()));
    listeners().output({ agentId: 'a', stream: 'stdout', line: 'tail', timestamp: 0 });
    unmount();
    expect(onBatch).toHaveBeenCalledWith([['a', ['tail'], [expect.any(Number)]]]);
  });
});

describe('useBatchedAgentEvents – going hidden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAgentOutput.mockReturnValue(vi.fn());
    mockOnAgentStatus.mockReturnValue(vi.fn());
  });

  it('hands pending output over when the window becomes hidden', () => {
    const onBatch = vi.fn();
    renderHook(() => useBatchedAgentEvents(onBatch, vi.fn()));
    const output = mockOnAgentOutput.mock.calls[0][0] as (e: unknown) => void;
    output({ agentId: 'a', stream: 'stdout', line: 'pending', timestamp: 0 });
    expect(onBatch).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('visibilitychange'));

    expect(onBatch).toHaveBeenCalledWith([['a', ['pending'], [expect.any(Number)]]]);
  });
});

describe('useBatchedAgentEvents – what a snapshot for the agent window needs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAgentOutput.mockReturnValue(vi.fn());
    mockOnAgentStatus.mockReturnValue(vi.fn());
  });

  const output = () => mockOnAgentOutput.mock.calls[0][0] as (e: unknown) => void;

  it('knows no offset for an agent it never heard from', () => {
    expect(agentOutputOffset('never-seen')).toBe(0);
  });

  it('records the newest offset per agent', () => {
    renderHook(() => useBatchedAgentEvents(vi.fn(), vi.fn()));
    output()({ agentId: 'o1', stream: 'stdout', line: 'hello', timestamp: 0, endOffset: 5 });
    output()({ agentId: 'o2', stream: 'stdout', line: 'x', timestamp: 0, endOffset: 1 });
    output()({ agentId: 'o1', stream: 'stdout', line: ' you', timestamp: 0, endOffset: 9 });

    expect(agentOutputOffset('o1')).toBe(9);
    expect(agentOutputOffset('o2')).toBe(1);
  });

  it('hands pending output over at once on flushAgentOutput, up to the recorded offset', () => {
    const onBatch = vi.fn();
    renderHook(() => useBatchedAgentEvents(onBatch, vi.fn()));
    output()({ agentId: 'f1', stream: 'stdout', line: 'pending', timestamp: 0, endOffset: 7 });
    expect(onBatch).not.toHaveBeenCalled();

    flushAgentOutput();

    expect(onBatch).toHaveBeenCalledWith([['f1', ['pending'], [expect.any(Number)]]]);
    expect(agentOutputOffset('f1')).toBe(7);
  });

  it('flushes nothing once the listener is gone', () => {
    const onBatch = vi.fn();
    const { unmount } = renderHook(() => useBatchedAgentEvents(onBatch, vi.fn()));
    unmount();
    onBatch.mockClear();

    expect(() => flushAgentOutput()).not.toThrow();
    expect(onBatch).not.toHaveBeenCalled();
  });
});
