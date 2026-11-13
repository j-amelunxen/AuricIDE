// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());
vi.mock('@/lib/tauri/clipboard', () => ({ copyToClipboard }));

import { COPIED_FEEDBACK_MS, useCopyFeedback } from './useCopyFeedback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCopyFeedback', () => {
  it('says copied for a moment after a copy that landed', async () => {
    copyToClipboard.mockResolvedValue(true);
    const { result } = renderHook(() => useCopyFeedback());

    await act(() => result.current.copy('text'));
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(COPIED_FEEDBACK_MS));
    expect(result.current.copied).toBe(false);
  });

  it('says nothing after a copy that failed', async () => {
    copyToClipboard.mockResolvedValue(false);
    const { result } = renderHook(() => useCopyFeedback());

    await act(() => result.current.copy('text'));
    expect(result.current.copied).toBe(false);
  });

  it('a second copy restarts the moment instead of being cut short by the first', async () => {
    copyToClipboard.mockResolvedValue(true);
    const { result } = renderHook(() => useCopyFeedback());

    await act(() => result.current.copy('one'));
    act(() => vi.advanceTimersByTime(COPIED_FEEDBACK_MS - 100));
    await act(() => result.current.copy('two'));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.copied).toBe(true);
  });
});
