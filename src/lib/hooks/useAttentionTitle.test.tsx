import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useAttentionTitle } from './useAttentionTitle';

vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => Date.now() }));

// The badge call is native-only — spy on it, keep the title path real.
vi.mock('@/lib/agents/windowTitle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/windowTitle')>();
  return { ...actual, applyDockBadge: vi.fn(async () => undefined) };
});

const agent = (overrides: Partial<AgentInfo>): AgentInfo => ({
  id: 'a1',
  name: 'Agent',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  ...overrides,
});

describe('useAttentionTitle – dock badge', () => {
  it('mirrors the count onto the dock badge alongside the title', async () => {
    const { applyDockBadge } = await import('@/lib/agents/windowTitle');
    const spy = vi.mocked(applyDockBadge);
    renderHook(() => useAttentionTitle([agent({ status: 'error' })]));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(1));
  });

  it('clears the badge when the fleet calms down', async () => {
    const { applyDockBadge } = await import('@/lib/agents/windowTitle');
    const spy = vi.mocked(applyDockBadge);
    const { rerender } = renderHook(({ agents }) => useAttentionTitle(agents), {
      initialProps: { agents: [agent({ status: 'error' })] },
    });
    rerender({ agents: [agent({ status: 'idle' })] });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(0));
  });
});

describe('useAttentionTitle', () => {
  it('badges the title while an agent needs a human', async () => {
    renderHook(() => useAttentionTitle([agent({ status: 'error' })]));
    // No Tauri backend in tests — the document fallback receives the title.
    await waitFor(() => expect(document.title).toBe('(1) AuricIDE'));
  });

  it('returns to the plain app name once the fleet is calm', async () => {
    const { rerender } = renderHook(({ agents }) => useAttentionTitle(agents), {
      initialProps: { agents: [agent({ status: 'error' })] },
    });
    await waitFor(() => expect(document.title).toBe('(1) AuricIDE'));

    rerender({ agents: [agent({ status: 'idle' })] });
    await waitFor(() => expect(document.title).toBe('AuricIDE'));
  });
});
