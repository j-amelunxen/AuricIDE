import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useAttentionTitle } from './useAttentionTitle';

vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => Date.now() }));

const agent = (overrides: Partial<AgentInfo>): AgentInfo => ({
  id: 'a1',
  name: 'Agent',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  ...overrides,
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
