import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenManager } from './useOpenManager';

const mockOpenManager = vi.fn();
vi.mock('@/lib/agents/openSupervisor', () => ({
  openManager: (...args: unknown[]) => mockOpenManager(...args),
}));

describe('useOpenManager', () => {
  beforeEach(() => {
    mockOpenManager.mockReset();
  });
  afterEach(cleanup);

  it('starts a manager once when it is opened twice in the same tick', async () => {
    let finish: () => void = () => undefined;
    mockOpenManager.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useOpenManager());

    act(() => {
      void result.current.open('release-desk');
      void result.current.open('release-desk');
    });
    expect(mockOpenManager).toHaveBeenCalledTimes(1);
    expect(result.current.opening).toBe('release-desk');

    finish();
    await waitFor(() => expect(result.current.opening).toBeNull());
  });

  it('lets an Ask through while an Open is in flight, so the work is not lost', async () => {
    let finish: () => void = () => undefined;
    mockOpenManager.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    mockOpenManager.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenManager());

    act(() => {
      void result.current.open('release-desk');
      void result.current.open('release-desk', { task: 'Check tickets' });
    });
    expect(mockOpenManager).toHaveBeenCalledTimes(2);
    expect(mockOpenManager.mock.calls[1][3]).toEqual({ task: 'Check tickets' });

    finish();
    await waitFor(() => expect(result.current.opening).toBeNull());
  });

  it('can open again once the first open has finished', async () => {
    mockOpenManager.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenManager());

    await act(async () => result.current.open('release-desk'));
    await act(async () => result.current.open('release-desk'));
    expect(mockOpenManager).toHaveBeenCalledTimes(2);
  });

  it('passes the task and model on to the one open verb', async () => {
    mockOpenManager.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenManager());

    await act(async () =>
      result.current.open('release-desk', { task: 'Check tickets', model: 'haiku' })
    );
    expect(mockOpenManager).toHaveBeenCalledWith(
      expect.objectContaining({ sendAgentInput: expect.any(Function), agents: expect.any(Array) }),
      'release-desk',
      expect.objectContaining({ onShow: expect.any(Function) }),
      { task: 'Check tickets', model: 'haiku' }
    );
  });
});
