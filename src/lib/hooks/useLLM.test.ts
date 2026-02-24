import { renderHook } from '@testing-library/react';
import { useLLM } from './useLLM';
import { describe, it, expect, vi } from 'vitest';

// Mock the tauri invoke/llmCall to avoid actual IPC in unit tests
vi.mock('@/lib/tauri/llm', () => ({
  llmCall: vi.fn(),
}));

describe('useLLM', () => {
  it('initializes with loading false and no error', () => {
    const { result } = renderHook(() => useLLM());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('provides a call function', () => {
    const { result } = renderHook(() => useLLM());
    expect(typeof result.current.call).toBe('function');
  });

  it('provides an abort function', () => {
    const { result } = renderHook(() => useLLM());
    expect(typeof result.current.abort).toBe('function');
  });
});
