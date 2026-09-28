import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

const spies = vi.hoisted(() => ({ mergeStreamFeed: 0, laneRail: 0, phaseChip: 0 }));

vi.mock('@/lib/agents/events/feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/events/feed')>();
  return {
    ...actual,
    mergeStreamFeed: (...args: Parameters<typeof actual.mergeStreamFeed>) => {
      spies.mergeStreamFeed++;
      return actual.mergeStreamFeed(...args);
    },
  };
});

vi.mock('./LaneRail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./LaneRail')>();
  return {
    ...actual,
    LaneRail: (props: Parameters<typeof actual.LaneRail>[0]) => {
      spies.laneRail++;
      return <actual.LaneRail {...props} />;
    },
  };
});

vi.mock('./PhaseChip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PhaseChip')>();
  return {
    ...actual,
    PhaseChip: (props: Parameters<typeof actual.PhaseChip>[0]) => {
      spies.phaseChip++;
      return <actual.PhaseChip {...props} />;
    },
  };
});

import { ActivityFeed } from './ActivityFeed';

function seed() {
  const now = Date.now();
  const agents: AgentInfo[] = [
    {
      id: 'a1',
      name: 'Writer',
      status: 'running',
      model: 'm',
      provider: 'claude',
      startedAt: now,
      lastActivityAt: now,
      repoPath: '/repos/app',
    },
  ];
  useStore.setState({
    agents,
    agentEvents: {},
    agentStreamLines: {},
    agentSentMessages: {},
    agentLogHistory: [],
    mutedAgentIds: [],
    laneSeenAt: {},
    agentColors: {},
    reviewedAgentIds: [],
    laneSummaries: {},
  } as Partial<ReturnType<typeof useStore.getState>>);
}

describe('ActivityFeed – work per chunk and per tick', () => {
  beforeEach(() => {
    spies.mergeStreamFeed = 0;
    spies.laneRail = 0;
    spies.phaseChip = 0;
    seed();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not rebuild the hidden output list when output arrives in activity mode', () => {
    render(<ActivityFeed />);
    act(() => {
      for (let i = 0; i < 10; i++) {
        useStore.setState({
          agentStreamLines: { a1: [{ text: `line ${i}`, at: Date.now(), seq: i }] },
        });
      }
    });
    expect(spies.mergeStreamFeed).toBe(0);
  });

  it('does not re-render the lane rail every second while no lane changes', () => {
    vi.useFakeTimers();
    render(<ActivityFeed />);
    const before = spies.laneRail;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(spies.laneRail).toBe(before);
  });

  it('does not re-render at all for output batches while the activity mode is shown', () => {
    render(<ActivityFeed />);
    const before = spies.laneRail;
    act(() => {
      for (let i = 0; i < 10; i++) {
        useStore.setState({
          agentStreamLines: { a1: [{ text: `line ${i}`, at: Date.now(), seq: i }] },
        });
      }
    });
    expect(spies.laneRail).toBe(before);
  });

  it('shows output batches in output mode without re-rendering the lane rail', async () => {
    render(<ActivityFeed />);
    act(() => {
      screen.getByRole('button', { name: 'All output' }).click();
    });
    const before = spies.phaseChip;
    act(() => {
      useStore.setState({
        agentStreamLines: { a1: [{ text: 'fresh output line', at: Date.now(), seq: 0 }] },
      });
    });
    expect(await screen.findByText('fresh output line')).toBeInTheDocument();
    expect(spies.phaseChip).toBe(before);
  });
});
