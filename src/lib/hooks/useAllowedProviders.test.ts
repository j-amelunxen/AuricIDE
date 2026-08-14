import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { ProviderPolicy } from '@/lib/config/providerPolicy';

const listProviders = vi.fn();
const loadProviderPolicy = vi.fn();

vi.mock('@/lib/tauri/providers', () => ({
  listProviders: (...args: unknown[]) => listProviders(...args),
}));

vi.mock('@/lib/config/projectConfig', () => ({
  loadProviderPolicy: (...args: unknown[]) => loadProviderPolicy(...args),
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (state: { rootPath: string }) => unknown) =>
    selector({ rootPath: '/tmp/project' }),
}));

import { useAllowedProviders } from './useAllowedProviders';

const provider = (id: string): ProviderInfo => ({
  id,
  name: id,
  models: [],
  permissionModes: [],
  defaultModel: '',
  defaultPermissionMode: '',
});

const FALLBACK = provider('crush');
const open: ProviderPolicy = { allow: null, deny: [] };

beforeEach(() => {
  vi.clearAllMocks();
  listProviders.mockResolvedValue([provider('claude'), provider('grok')]);
  loadProviderPolicy.mockResolvedValue(open);
});

describe('useAllowedProviders', () => {
  it('offers everything when the project set no policy', async () => {
    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.providers.map((p) => p.id)).toEqual(['claude', 'grok']);
    expect(result.current.blockedAll).toBe(false);
  });

  it('drops a denied provider', async () => {
    loadProviderPolicy.mockResolvedValue({ allow: null, deny: ['grok'] });

    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.providers.map((p) => p.id)).toEqual(['claude']);
  });

  it('narrows to an allow list', async () => {
    loadProviderPolicy.mockResolvedValue({ allow: ['grok'], deny: [] });

    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.providers.map((p) => p.id)).toEqual(['grok']);
  });

  it('reports when the policy leaves nothing', async () => {
    loadProviderPolicy.mockResolvedValue({ allow: null, deny: ['claude', 'grok'] });

    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.providers).toEqual([]);
    expect(result.current.blockedAll).toBe(true);
  });

  it('applies the policy to the browser-mode fallback too', async () => {
    // Otherwise a project that denies crush would still be offered it whenever
    // the registry is unreachable.
    listProviders.mockRejectedValue(new Error('no IPC'));
    loadProviderPolicy.mockResolvedValue({ allow: null, deny: ['crush'] });

    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.blockedAll).toBe(true);
  });

  it('keeps the fallback usable when the registry is unreachable', async () => {
    listProviders.mockRejectedValue(new Error('no IPC'));

    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.providers.map((p) => p.id)).toEqual(['crush']);
  });

  it('asks about the open project by default', async () => {
    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(loadProviderPolicy).toHaveBeenCalledWith('/tmp/project');
  });

  it('asks about the repository an agent is actually aimed at', async () => {
    // Rust checks the policy of the directory the agent runs in. Filtering by
    // the open project would offer providers the spawn then refuses.
    const { result } = renderHook(() => useAllowedProviders(FALLBACK, '/tmp/other-repo'));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(loadProviderPolicy).toHaveBeenCalledWith('/tmp/other-repo');
  });

  it('starts with the fallback so a picker has something to render', () => {
    const { result } = renderHook(() => useAllowedProviders(FALLBACK));

    expect(result.current.ready).toBe(false);
    expect(result.current.providers).toEqual([FALLBACK]);
  });
});
