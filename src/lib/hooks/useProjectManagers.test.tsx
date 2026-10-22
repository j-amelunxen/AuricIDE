import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readManagerPresentations,
  updateManagerPresentation,
} from '@/lib/quickAccess/managerPresentation';
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
  beforeEach(() => {
    mockRegistry.mockReset();
    localStorage.clear();
  });
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

  it('keeps the same object when a re-read finds the registry unchanged', async () => {
    mockRegistry.mockImplementation(async () => registryWith('a'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.managers).toHaveLength(1));
    const first = result.current;
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mockRegistry).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(result.current).toBe(first);
  });

  it('keeps the last good list and names the error when a later read fails', async () => {
    mockRegistry.mockResolvedValueOnce(registryWith('a'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.managers).toHaveLength(1));

    mockRegistry.mockRejectedValueOnce(new Error('disk is busy'));
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.error).toContain('disk is busy'));
    expect(result.current.managers.map((m) => m.key)).toEqual(['a']);
  });

  it('forgets the display choices of a manager that was removed, but not on a failed read', async () => {
    updateManagerPresentation('removed', { shortcut: 'F5' });
    updateManagerPresentation('a', { shortcut: 'F6' });
    mockRegistry.mockRejectedValueOnce(new Error('disk is busy'));
    const { result } = renderHook(() => useProjectManagers());
    await waitFor(() => expect(result.current.error).toContain('disk is busy'));
    expect(Object.keys(readManagerPresentations())).toEqual(['removed', 'a']);

    mockRegistry.mockResolvedValueOnce({ managers: [], error: 'The registry could not be read.' });
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mockRegistry).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(Object.keys(readManagerPresentations())).toEqual(['removed', 'a']);

    mockRegistry.mockResolvedValueOnce(registryWith('a'));
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(Object.keys(readManagerPresentations())).toEqual(['a']));
  });

  it('ignores an older read that finishes after a newer one', async () => {
    let finishOld: (value: ReturnType<typeof registryWith>) => void = () => undefined;
    mockRegistry.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
    const { result } = renderHook(() => useProjectManagers());
    mockRegistry.mockResolvedValueOnce(registryWith('new'));
    act(() => void window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.managers.map((m) => m.key)).toEqual(['new']));

    await act(async () => finishOld(registryWith('old')));
    expect(result.current.managers.map((m) => m.key)).toEqual(['new']);
  });
});
