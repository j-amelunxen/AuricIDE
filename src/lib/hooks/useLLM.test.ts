// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { llmCall } from '@/lib/tauri/llm';
import { useLLM } from './useLLM';

vi.mock('@/lib/tauri/llm', () => ({ llmCall: vi.fn() }));

const ask = [{ role: 'user' as const, content: 'hi' }];

describe('useLLM', () => {
  beforeEach(() => {
    vi.mocked(llmCall).mockReset();
    useStore.setState({ rootPath: '/project' });
  });

  it('answers with the model reply and sends the open project', async () => {
    vi.mocked(llmCall).mockResolvedValue({ content: 'hello' } as never);
    const { result } = renderHook(() => useLLM());

    let reply: string | null = null;
    await act(async () => {
      reply = await result.current.call(ask, { temperature: 0.2 });
    });

    expect(reply).toBe('hello');
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/project', temperature: 0.2 })
    );
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the error of a failed call for the caller to show', async () => {
    vi.mocked(llmCall).mockRejectedValue(new Error('no key'));
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await result.current.call(ask);
    });

    expect(result.current.error).toBe('no key');
  });

  it('drops the reply of a call that was aborted meanwhile', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(llmCall).mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const { result } = renderHook(() => useLLM());

    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.call(ask);
    });
    act(() => result.current.abort());
    resolve({ content: 'late' });

    await expect(pending).resolves.toBeNull();
  });

  it('refuses without an open project', async () => {
    useStore.setState({ rootPath: null });
    const { result } = renderHook(() => useLLM());

    await act(async () => {
      await expect(result.current.call(ask)).resolves.toBeNull();
    });

    expect(result.current.error).toBe('No project open');
    expect(llmCall).not.toHaveBeenCalled();
  });
});
