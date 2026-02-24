import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockOnAgentOutput = vi.fn();
const mockOnAgentStatus = vi.fn();

vi.mock('../tauri/agentEvents', () => ({
  onAgentOutput: (...args: unknown[]) => mockOnAgentOutput(...args),
  onAgentStatus: (...args: unknown[]) => mockOnAgentStatus(...args),
}));

import { useAgentEvents } from './useAgentEvents';

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
