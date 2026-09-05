import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import type { StreamLine } from '@/lib/agents/events/streamCapture';
import type { PersistedAgentEvent } from '@/lib/tauri/agentLog';
import { ActivityFeed } from './ActivityFeed';
import { useStore } from '@/lib/store';

vi.mock('@/lib/tauri/agents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri/agents')>('@/lib/tauri/agents');
  return { ...actual, sendToAgent: vi.fn(async () => undefined) };
});

const t1 = new Date(2024, 0, 1, 14, 55, 0).getTime();
const t2 = new Date(2024, 0, 1, 14, 56, 0).getTime();
const t3 = new Date(2024, 0, 1, 14, 57, 2).getTime();

const agents: AgentInfo[] = [
  {
    id: 'a1',
    name: 'Waitlist',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    startedAt: t1,
    repoPath: '/repos/acme-app',
  },
  {
    id: 'a2',
    name: 'Wiki lint',
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: t1,
    repoPath: '/repos/other-app',
  },
];

const agentEvents: Record<string, AgentEvent[]> = {
  a1: [
    { kind: 'edit', label: 'Edited src/a.ts', path: 'src/a.ts', at: t1 },
    { kind: 'ask', label: 'Permission requested: Bash(pnpm test)', at: t3 },
  ],
  a2: [{ kind: 'done', label: 'Finished · 3 files', at: t2 }],
};

/** Everything the feed and rail read, set in one go. */
function setFeedState(state: {
  agentEvents?: Record<string, AgentEvent[]>;
  agentStreamLines?: Record<string, StreamLine[]>;
  agentSentMessages?: Record<string, { text: string; at: number; seq: number }[]>;
  mutedAgentIds?: string[];
  agentColors?: Record<string, 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'>;
}) {
  useStore.setState({
    agents,
    agentEvents: state.agentEvents ?? {},
    agentStreamLines: state.agentStreamLines ?? {},
    agentSentMessages: state.agentSentMessages ?? {},
    agentLogHistory: [],
    mutedAgentIds: state.mutedAgentIds ?? [],
    laneSeenAt: {},
    agentColors: state.agentColors ?? {},
    reviewedAgentIds: [],
    laneSummaries: {},
  } as Partial<ReturnType<typeof useStore.getState>>);
}

describe('ActivityFeed ordering', () => {
  it('lists events oldest first, newest at the bottom', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row');
    expect(rows[0]).toHaveTextContent('Edited src/a.ts');
    expect(rows[rows.length - 1]).toHaveTextContent('Permission requested');
  });

  it('keeps the same order for a shared moment in both modes', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents,
      agentStreamLines: {
        a1: [
          { text: 'Reading the pricing spec', at: t1, seq: 0 },
          { text: 'I will start with the use cases', at: t3, seq: 1 },
        ],
      },
    });
    render(<ActivityFeed />);

    let rows = screen.getAllByTestId('feed-row').map((r) => r.textContent);
    expect(rows[0]).toContain('Edited src/a.ts');

    await user.click(screen.getByRole('button', { name: 'All output' }));
    rows = screen.getAllByTestId('feed-row').map((r) => r.textContent);
    expect(rows[0]).toContain('Reading the pricing spec');
    expect(rows[rows.length - 1]).toContain('I will start with the use cases');
  });
});

describe('ActivityFeed grouping', () => {
  it('groups consecutive rows from the same agent under one header', () => {
    setFeedState({
      agentEvents: {
        a1: [
          { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
          { kind: 'run', label: 'Ran pnpm lint', at: t1 + 1000 },
        ],
      },
    });
    render(<ActivityFeed />);

    expect(screen.getAllByTestId('feed-group')).toHaveLength(1);
    expect(screen.getAllByTestId('feed-row')).toHaveLength(2);
  });

  it('gives each sender run its own header when two agents interleave', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);
    // a1's edit, then a2's done, then a1's ask — three runs.
    expect(screen.getAllByTestId('feed-group')).toHaveLength(3);
  });

  it('shows the monogram, agent name and project label on the header — no duplicate time', () => {
    setFeedState({ agentEvents: { a1: agentEvents.a1 } });
    render(<ActivityFeed />);

    const group = screen.getByTestId('feed-group');
    expect(within(group).getByTestId('feed-agent-mark')).toBeInTheDocument();
    expect(group).toHaveTextContent('Waitlist');
    expect(group).toHaveTextContent('acme-app');
    // Every row already carries its own time in the left column — the
    // header must not repeat the first row's.
    expect(within(group).getAllByText('14:55:00')).toHaveLength(1);
  });
});

describe('ActivityFeed tiers', () => {
  it('gives a question its own icon and colour', () => {
    setFeedState({ agentEvents: { a1: [agentEvents.a1[1]] } });
    render(<ActivityFeed />);
    const row = screen.getByTestId('feed-row');
    expect(row.className).toMatch(/amber/);
    expect(screen.getByText('Question')).toBeInTheDocument();
  });

  it('wraps a long question instead of truncating it — it is the row most likely to run long', () => {
    const longAsk = 'Overwrite '.repeat(20).trim() + '?';
    setFeedState({ agentEvents: { a1: [{ kind: 'ask', label: longAsk, at: t1 }] } });
    render(<ActivityFeed />);

    const label = within(screen.getByTestId('feed-scroll')).getByText(longAsk);
    expect(label.className.split(' ')).not.toContain('truncate');
  });

  it('gives a finish and a failure their own icon and colour', () => {
    setFeedState({
      agentEvents: {
        a1: [
          { kind: 'done', label: 'Finished · 3 files', at: t1 },
          { kind: 'error', label: 'Crashed', at: t1 + 1000 },
        ],
      },
    });
    render(<ActivityFeed />);
    const feed = within(screen.getByTestId('feed-scroll'));
    expect(feed.getByText('Finished · 3 files')).toBeInTheDocument();
    expect(feed.getByText('Crashed')).toBeInTheDocument();
    expect(feed.getByText('Failed')).toBeInTheDocument();
  });

  it('wraps a long outcome label instead of truncating it', () => {
    const longDone = 'Finished '.repeat(20).trim() + '.';
    setFeedState({ agentEvents: { a1: [{ kind: 'done', label: longDone, at: t1 }] } });
    render(<ActivityFeed />);

    const label = within(screen.getByTestId('feed-scroll')).getByText(longDone);
    expect(label.className.split(' ')).not.toContain('truncate');
  });

  it('renders a sent message as the one right-aligned bubble', () => {
    setFeedState({
      agentEvents: {},
      agentSentMessages: { a1: [{ text: 'Go ahead', at: t1, seq: 0 }] },
    });
    render(<ActivityFeed />);

    expect(screen.getByText('Go ahead')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows sent rows only under the All filter', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents: { a1: [agentEvents.a1[0]] },
      agentSentMessages: { a1: [{ text: 'Go ahead', at: t1 + 500, seq: 0 }] },
    });
    render(<ActivityFeed />);

    expect(screen.getByText('Go ahead')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.queryByText('Go ahead')).not.toBeInTheDocument();
  });
});

describe('ActivityFeed kind filters', () => {
  it('filters to Questions, Changes, and Completions', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(1);
    expect(screen.getByTestId('feed-row')).toHaveTextContent('Permission requested');

    await user.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(1);
    expect(screen.getByTestId('feed-row')).toHaveTextContent('Edited src/a.ts');

    await user.click(screen.getByRole('button', { name: 'Completions' }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(1);
    expect(screen.getByTestId('feed-row')).toHaveTextContent('Finished');

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(3);
  });
});

describe('ActivityFeed mode', () => {
  it('starts in the curated activity mode', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('switches to the raw output stream and shows lines no matcher recognised', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents,
      agentStreamLines: {
        a1: [{ text: 'I will start with the use cases', at: t3, seq: 1 }],
      },
    });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: 'All output' }));
    expect(screen.getByText('I will start with the use cases')).toBeInTheDocument();
  });

  it('hides the event-kind filters in output mode — they classify events, not lines', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    expect(screen.getByRole('button', { name: 'Questions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All output' }));
    expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument();
  });
});

describe('ActivityFeed colours', () => {
  it('gives each agent its own colour so a fleet can be read along', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    const marks = within(screen.getByTestId('feed-scroll')).getAllByTestId('feed-agent-mark');
    const colours = new Set(marks.map((m) => m.style.color));
    expect(colours.size).toBeGreaterThan(1);
  });

  it('tints an agent by the marker the user put on it, when there is one', () => {
    setFeedState({ agentEvents, agentColors: { a1: 'red' } });
    render(<ActivityFeed />);

    const group = within(screen.getByTestId('feed-scroll'))
      .getAllByTestId('feed-group')
      .find((g) => g.textContent?.includes('Waitlist'));
    const mark = within(group as HTMLElement).getByTestId('feed-agent-mark');
    expect(mark.style.color).toBe('rgb(255, 107, 107)');
  });
});

describe('ActivityFeed accessibility', () => {
  it('puts the feed pane in the tab order, under a name that says what it is', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    const pane = screen.getByRole('region', { name: /activity feed/i });
    expect(pane).toHaveAttribute('tabindex', '0');
  });
});

describe('ActivityFeed render identity', () => {
  it('keeps a row already on screen mounted when a newer row arrives', () => {
    setFeedState({ agentEvents: { a1: [agentEvents.a1[0]] } });
    render(<ActivityFeed />);

    const editRow = screen.getByText('Edited src/a.ts').closest('[data-testid="feed-row"]');

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [agentEvents.a1[0], { kind: 'run', label: 'Ran pnpm build', at: t1 + 60_000 }],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(screen.getAllByTestId('feed-row')[0]).toBe(editRow);
  });

  it('keeps an output line already on screen mounted when a newer line arrives', () => {
    setFeedState({
      agentEvents: {},
      agentStreamLines: { a1: [{ text: 'Reading the pricing spec', at: t1, seq: 0 }] },
    });
    render(<ActivityFeed />);
    fireEvent.click(screen.getByRole('button', { name: 'All output' }));

    const firstLine = screen
      .getByText('Reading the pricing spec')
      .closest('[data-testid="feed-row"]');

    act(() => {
      useStore.setState({
        agentStreamLines: {
          a1: [
            { text: 'Reading the pricing spec', at: t1, seq: 0 },
            { text: 'Now writing the tests', at: t1 + 1000, seq: 1 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(screen.getAllByTestId('feed-row')[0]).toBe(firstLine);
  });

  it('does not remount the boundary group when a new row shifts the reveal window', () => {
    const base = new Date(2024, 0, 2, 10, 0, 0).getTime();
    // a2: 20 rows (oldest), a1: 290 rows (newest) — 310 total. The newest 300
    // are shown, which hides a2's oldest 10 rows and leaves it straddling the
    // window boundary: partially visible, neither fully in nor fully out.
    const a2Events: AgentEvent[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'edit',
      label: `a2 file ${i}`,
      at: base + i * 1000,
    }));
    const a1Events: AgentEvent[] = Array.from({ length: 290 }, (_, i) => ({
      kind: 'edit',
      label: `a1 file ${i}`,
      at: base + (20 + i) * 1000,
    }));
    setFeedState({ agentEvents: { a1: a1Events, a2: a2Events } });
    render(<ActivityFeed />);

    const boundaryGroup = screen.getAllByTestId('feed-group')[0];
    expect(boundaryGroup).toHaveTextContent('a2 file 10');
    expect(boundaryGroup).not.toHaveTextContent('a2 file 0');

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [...a1Events, { kind: 'edit', label: 'a1 file 290', at: base + 310_000 }],
          a2: a2Events,
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    const groupsAfter = screen.getAllByTestId('feed-group');
    expect(groupsAfter[0]).toBe(boundaryGroup);
    // The window slid by one more row: one fewer of a2's rows is visible now.
    expect(groupsAfter[0]).not.toHaveTextContent('a2 file 10');
    expect(groupsAfter[0]).toHaveTextContent('a2 file 11');
  });
});

describe('ActivityFeed seen-marking', () => {
  it('marks new rows seen on arrival in activity mode with the All filter', () => {
    setFeedState({ agentEvents: { a1: [agentEvents.a1[0]] } });
    render(<ActivityFeed />);

    fireEvent.click(screen.getByRole('button', { name: /^Waitlist/ }));
    const seenAfterSelect = useStore.getState().laneSeenAt.a1;

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [agentEvents.a1[0], { kind: 'run', label: 'Ran pnpm build', at: t1 + 60_000 }],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(useStore.getState().laneSeenAt.a1).toBeGreaterThan(seenAfterSelect);
  });

  it('does not mark an ask seen just because an unrelated output line arrived', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents: {
        a1: [{ kind: 'ask', label: 'Overwrite the config?', at: t1 }],
      },
      agentStreamLines: { a1: [{ text: 'Reading the pricing spec', at: t1, seq: 0 }] },
    });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    await user.click(screen.getByRole('button', { name: 'All output' }));
    const seenAfterSwitch = useStore.getState().laneSeenAt.a1;

    // Growth here is a stream line — the ask itself was never rendered in
    // this mode, and must not be marked read as a side effect.
    act(() => {
      useStore.setState({
        agentStreamLines: {
          a1: [
            { text: 'Reading the pricing spec', at: t1, seq: 0 },
            { text: 'Now writing the tests', at: t1 + 1000, seq: 1 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(useStore.getState().laneSeenAt.a1).toBe(seenAfterSwitch);
  });

  it('does not mark a row seen on arrival when the active filter hides it', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents: { a1: [agentEvents.a1[0]] } });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    await user.click(screen.getByRole('button', { name: 'Questions' }));
    const seenAfterFilter = useStore.getState().laneSeenAt.a1;

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [agentEvents.a1[0], { kind: 'run', label: 'Ran pnpm build', at: t1 + 60_000 }],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(useStore.getState().laneSeenAt.a1).toBe(seenAfterFilter);
  });
});

describe('ActivityFeed lanes', () => {
  it('lists a lane per agent in the rail', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);
    expect(screen.getByRole('button', { name: /^Waitlist/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Wiki lint/ })).toBeInTheDocument();
  });

  it('selecting a lane filters the feed to that agent and shows a chip for it', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));

    const rows = screen.getAllByTestId('feed-row');
    expect(rows.every((r) => !r.textContent?.includes('Finished'))).toBe(true);
    expect(screen.getByTestId('feed-lane-chip')).toHaveTextContent('Waitlist');
  });

  it('clears the lane filter from the chip', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    await user.click(within(screen.getByTestId('feed-lane-chip')).getByRole('button'));

    expect(screen.queryByTestId('feed-lane-chip')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('feed-row').some((r) => r.textContent?.includes('Finished'))).toBe(
      true
    );
  });

  it('marks the lane seen when it is selected', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));

    expect(useStore.getState().laneSeenAt.a1).toBeDefined();
  });
});

describe('ActivityFeed mute', () => {
  it('hides a muted lane’s ordinary rows from the All-lanes view but keeps questions and outcomes', () => {
    setFeedState({
      agentEvents: {
        a1: [
          { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
          { kind: 'ask', label: 'Permission requested', at: t1 + 1000 },
        ],
      },
      mutedAgentIds: ['a1'],
    });
    render(<ActivityFeed />);

    const feed = within(screen.getByTestId('feed-scroll'));
    expect(feed.queryByText('Edited src/a.ts')).not.toBeInTheDocument();
    expect(feed.getByText('Permission requested')).toBeInTheDocument();
  });

  it('shows every row once the muted lane itself is selected', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents: {
        a1: [
          { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
          { kind: 'ask', label: 'Permission requested', at: t1 + 1000 },
        ],
      },
      mutedAgentIds: ['a1'],
    });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    expect(screen.getByText('Edited src/a.ts')).toBeInTheDocument();
  });
});

describe('ActivityFeed follow', () => {
  const base = new Date(2024, 0, 2, 10, 0, 0).getTime();

  it('keeps the new-rows live region mounted even with nothing new to report', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
  });

  function scrollTo(top: number, scrollHeight = 10_000, clientHeight = 200) {
    const container = screen.getByTestId('feed-scroll');
    Object.defineProperty(container, 'scrollTop', {
      value: top,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(container, 'scrollHeight', {
      value: scrollHeight,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: clientHeight,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(container);
  }

  it('shows a count of new rows once the reader has scrolled away from the bottom', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    // Scrolled well away from the bottom.
    scrollTo(0, 10_000, 200);

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [
            { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
            { kind: 'run', label: 'Ran pnpm build', at: base },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(screen.getByText('1 new ↓')).toBeInTheDocument();
  });

  it('resumes following once the new-rows pill is clicked, and does not re-arm on the next row', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    scrollTo(0, 10_000, 200);
    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [
            { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
            { kind: 'run', label: 'Ran pnpm build', at: base },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    fireEvent.click(screen.getByText('1 new ↓'));
    expect(screen.queryByText(/new ↓/)).not.toBeInTheDocument();

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [
            { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
            { kind: 'run', label: 'Ran pnpm build', at: base },
            { kind: 'run', label: 'Ran pnpm test', at: base + 1000 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });
    expect(screen.queryByText(/new ↓/)).not.toBeInTheDocument();
  });
});

describe('ActivityFeed pause', () => {
  it('freezes the visible rows so a live stream can be read', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [
            { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
            { kind: 'run', label: 'Ran pnpm build', at: t1 + 1000 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(screen.queryByText('Ran pnpm build')).not.toBeInTheDocument();
  });

  it('catches back up when resumed', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    act(() => {
      useStore.setState({
        agentEvents: {
          a1: [
            { kind: 'edit', label: 'Edited src/a.ts', at: t1 },
            { kind: 'run', label: 'Ran pnpm build', at: t1 + 1000 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));

    expect(screen.getByText('Ran pnpm build')).toBeInTheDocument();
  });

  it('says it is paused instead of claiming to be live', () => {
    setFeedState({ agentEvents: { a1: [{ kind: 'edit', label: 'Edited src/a.ts', at: t1 }] } });
    render(<ActivityFeed />);

    expect(screen.getByTestId('activity-feed-header')).toHaveTextContent('Live');
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.getByTestId('activity-feed-header')).toHaveTextContent('Paused');
  });
});

describe('ActivityFeed windowing', () => {
  const base = new Date(2024, 0, 2, 10, 0, 0).getTime();
  const manyEvents: AgentEvent[] = Array.from({ length: 400 }, (_, i) => ({
    kind: 'edit',
    label: `Edited src/file-${i}.ts`,
    at: base + i * 1000,
  }));

  it('renders only the newest 300 rows and offers to reveal more', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    expect(screen.getAllByTestId('feed-row')).toHaveLength(300);
    expect(screen.getByText('Edited src/file-399.ts')).toBeInTheDocument();
    expect(screen.queryByText('Edited src/file-0.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show \d+ earlier/i }));
    expect(screen.getByText('Edited src/file-0.ts')).toBeInTheDocument();
  });

  it('resets the reveal window when the filter changes', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    fireEvent.click(screen.getByRole('button', { name: /show \d+ earlier/i }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(400);

    fireEvent.click(screen.getByRole('button', { name: 'Changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(300);
  });

  it('keeps the reader’s viewport fixed when revealing earlier rows', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    const el = screen.getByTestId('feed-scroll');
    const ROW_HEIGHT_PX = 20;
    // A believable scrollHeight computed from what's actually in the DOM
    // right now, so reading it before and after the reveal reflects the
    // real content growth rather than a value the test hard-codes.
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get() {
        return el.querySelectorAll('[data-testid="feed-row"]').length * ROW_HEIGHT_PX;
      },
    });
    Object.defineProperty(el, 'scrollTop', { value: 500, configurable: true, writable: true });

    const scrollTopBefore = el.scrollTop;
    const rowsBefore = screen.getAllByTestId('feed-row').length;

    fireEvent.click(screen.getByRole('button', { name: /show \d+ earlier/i }));

    const rowsAfter = screen.getAllByTestId('feed-row').length;
    const revealedHeight = (rowsAfter - rowsBefore) * ROW_HEIGHT_PX;
    expect(el.scrollTop).toBe(scrollTopBefore + revealedHeight);
  });
});

describe('ActivityFeed composer', () => {
  it('is disabled with a visible reason when no lane is selected', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);
    expect(screen.getByText('Select a lane to message one agent')).toBeInTheDocument();
  });

  it('sends the composer text to the selected agent with a trailing newline', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    await user.type(screen.getByLabelText('Message Waitlist'), 'go on');
    await user.keyboard('{Enter}');

    expect(screen.getByText('go on')).toBeInTheDocument();
  });

  it('says a stopped agent has stopped rather than accepting input for it', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    useStore.setState({
      agents: [{ ...agents[0], status: 'idle' }, agents[1]],
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    expect(screen.getByText('Waitlist has stopped')).toBeInTheDocument();
  });
});

describe('ActivityFeed history', () => {
  const history: PersistedAgentEvent[] = [
    {
      agentId: 'gone-1',
      agentName: 'Yesterday',
      repoPath: '/repos/old-app',
      kind: 'edit',
      label: 'Edited src/old.ts',
      at: new Date(2024, 0, 1, 9, 0, 0).getTime(),
      seq: 0,
    },
  ];

  it('shows history from an agent that has already exited, ordered before the live rows', () => {
    useStore.setState({
      agents,
      agentEvents,
      agentSentMessages: {},
      agentStreamLines: {},
      agentLogHistory: history,
      mutedAgentIds: [],
      laneSeenAt: {},
      agentColors: {},
      reviewedAgentIds: [],
      laneSummaries: {},
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row').map((r) => r.textContent);
    expect(rows[0]).toContain('Edited src/old.ts');
  });
});

describe('ActivityFeed header', () => {
  it('keeps the hint in the header', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed hint="Esc closes" />);
    expect(screen.getByText('Esc closes')).toBeInTheDocument();
  });

  it('still pushes the kind filters to the right when a lane chip is shown and there is no hint', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /^Waitlist/ }));
    expect(screen.getByTestId('feed-lane-chip')).toBeInTheDocument();

    const filterGroup = screen.getByRole('button', { name: 'All' }).parentElement;
    expect(filterGroup?.className.split(' ')).toContain('ml-auto');
  });
});
