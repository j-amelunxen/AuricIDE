import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGERS_CHANGED_EVENT } from '@/lib/tauri/supervisorManagers';
import { useProjectManagers } from './useProjectManagers';

const mockRegistry = vi.fn();
vi.mock('@/lib/tauri/supervisorManagers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/supervisorManagers')>()),
  managerRegistry: () => mockRegistry(),
}));

const registryWith = (...keys: string[]) => ({
  managers: keys.map((key) => ({ key })),
  error: null,
});

describe('useProjectManagers', () => {
  beforeEach(() => mockRegistry.mockReset());
  afterEach(cleanup);

  it('reads the registry on mount', async () => {
    mockRegistry.mockResolvedValue(registryWith('release-desk'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.managers).toHaveLength(1));
  });

  it('reads it again after a change and when the window regains focus', async () => {
    mockRegistry.mockResolvedValueOnce(registryWith('a'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.managers).toHaveLength(1));

    mockRegistry.mockResolvedValueOnce(registryWith('a', 'b'));
    act(() => void window.dispatchEvent(new Event(MANAGERS_CHANGED_EVENT)));
    await waitFor(() => expect(result.current.managers).toHaveLength(2));

    mockRegistry.mockResolvedValueOnce(registryWith('b'));
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.managers.map((m) => m.key)).toEqual(['b']));
  });

  it('is empty, not broken, when there is no IPC', async () => {
    mockRegistry.mockRejectedValueOnce(new Error('Tauri IPC is unavailable (manager_list)'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(mockRegistry).toHaveBeenCalled());
    expect(result.current).toEqual({ managers: [], error: null });
  });

  it('keeps the registry error so a writer can be disabled', async () => {
    mockRegistry.mockResolvedValue({ managers: [], error: 'The registry could not be read.' });
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.error).toBe('The registry could not be read.'));
  });
});
