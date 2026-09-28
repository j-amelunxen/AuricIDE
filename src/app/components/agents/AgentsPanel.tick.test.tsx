import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AGENT_STALL_MS } from '@/lib/agents/attention';

const renders = vi.hoisted(() => ({ header: 0, cardHeader: 0 }));

vi.mock('./panel/AgentsPanelHeader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./panel/AgentsPanelHeader')>();
  return {
    ...actual,
    AgentsPanelHeader: (props: Parameters<typeof actual.AgentsPanelHeader>[0]) => {
      renders.header++;
      return <actual.AgentsPanelHeader {...props} />;
    },
  };
});

vi.mock('./card/AgentCardHeader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./card/AgentCardHeader')>();
  return {
    ...actual,
    AgentCardHeader: (props: Parameters<typeof actual.AgentCardHeader>[0]) => {
      renders.cardHeader++;
      return <actual.AgentCardHeader {...props} />;
    },
  };
});

import { AgentsPanel } from './AgentsPanel';

function runningAgent(): AgentInfo {
  const t = Date.now();
  return {
    id: 'agent-1',
    name: 'Writer',
    model: 'm',
    provider: 'claude',
    status: 'running',
    currentTask: 'Writing docs',
    startedAt: t,
    // Quiet, but far from stalled: nothing the panel shows changes for minutes.
    lastActivityAt: t - 30_000,
  };
}

describe('AgentsPanel – the 1-second tick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-render the panel or its cards while nothing the clock decides changes', () => {
    vi.useFakeTimers();
    render(<AgentsPanel agents={[runningAgent()]} onSpawn={vi.fn()} onKill={vi.fn()} />);
    const before = { ...renders };
    const runtime = screen.getByTestId('agent-runtime').textContent;

    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(renders).toEqual(before);
    // …while the running time, a leaf of its own, still counts.
    expect(screen.getByTestId('agent-runtime').textContent).not.toBe(runtime);
  });

  it('re-renders when an agent crosses into stalled, so the attention count is current', () => {
    vi.useFakeTimers();
    render(<AgentsPanel agents={[runningAgent()]} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('attention-agents')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(AGENT_STALL_MS);
    });

    expect(screen.getByTestId('attention-agents')).toBeInTheDocument();
  });
});
