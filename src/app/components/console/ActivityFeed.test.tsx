import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import type { StreamLine } from '@/lib/agents/events/streamCapture';
import type { PersistedAgentEvent } from '@/lib/tauri/agentLog';
import { ActivityFeed } from './ActivityFeed';
import { useStore } from '@/lib/store';

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

function setStoreState() {
  useStore.setState({ agents, agentEvents } as Partial<ReturnType<typeof useStore.getState>>);
}

describe('ActivityFeed', () => {
  it('lists events newest first', () => {
    setStoreState();
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Permission requested');
    expect(rows[1]).toHaveTextContent('Finished');
    expect(rows[2]).toHaveTextContent('Edited src/a.ts');
  });

  it('shows the clock time, project and agent name for each row', () => {
    setStoreState();
    render(<ActivityFeed />);

    expect(screen.getAllByTestId('feed-row')[0]).toHaveTextContent(
      '14:57:02 · acme-app/Waitlist · Permission requested: Bash(pnpm test)'
    );
  });

  it('filters to Questions, Changes, and Completions', async () => {
    setStoreState();
    const user = userEvent.setup();
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

  it('colours a row by its event kind', async () => {
    setStoreState();
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row');
    const askRow = rows.find((r) => r.textContent?.includes('Permission requested'));
    const doneRow = rows.find((r) => r.textContent?.includes('Finished'));
    const editRow = rows.find((r) => r.textContent?.includes('Edited'));

    expect(askRow?.className).toMatch(/amber/);
    expect(doneRow?.className).toMatch(/primary/);
    expect(editRow?.className).not.toMatch(/amber|primary|red/);
  });
});

describe('ActivityFeed output mode', () => {
  const streamLines: Record<string, StreamLine[]> = {
    a1: [
      { text: 'Reading the pricing spec', at: t1, seq: 0 },
      { text: 'I will start with the use cases', at: t3, seq: 1 },
    ],
    a2: [{ text: 'Linting 41 wiki pages', at: t2, seq: 0 }],
  };

  function setStreamState() {
    useStore.setState({ agents, agentEvents, agentStreamLines: streamLines } as Partial<
      ReturnType<typeof useStore.getState>
    >);
  }

  it('starts in the curated activity mode', () => {
    setStreamState();
    render(<ActivityFeed />);
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('switches to the raw output stream and shows lines no matcher recognised', async () => {
    // This is the gap the curated feed leaves: prose an agent wrote is not a
    // tool call, so no matcher produces an event for it.
    const user = userEvent.setup();
    setStreamState();
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: 'All output' }));

    expect(screen.getByText('I will start with the use cases')).toBeInTheDocument();
    expect(screen.getByText('Linting 41 wiki pages')).toBeInTheDocument();
  });

  it('interleaves the agents newest first in output mode', async () => {
    const user = userEvent.setup();
    setStreamState();
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: 'All output' }));

    const rows = screen.getAllByTestId('feed-row').map((r) => r.textContent);
    expect(rows[0]).toContain('I will start with the use cases');
    expect(rows[1]).toContain('Linting 41 wiki pages');
    expect(rows[2]).toContain('Reading the pricing spec');
  });

  it('hides the event-kind filters in output mode — they classify events, not lines', async () => {
    const user = userEvent.setup();
    setStreamState();
    render(<ActivityFeed />);

    expect(screen.getByRole('button', { name: 'Questions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All output' }));
    expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument();
  });

  it('gives each agent its own colour so a fleet can be read along', async () => {
    const user = userEvent.setup();
    setStreamState();
    render(<ActivityFeed />);
    await user.click(screen.getByRole('button', { name: 'All output' }));

    const marks = screen.getAllByTestId('feed-agent-mark');
    const colours = new Set(marks.map((m) => m.style.color));
    expect(colours.size).toBeGreaterThan(1);
  });

  it('tints an agent by the marker the user put on it, when there is one', async () => {
    const user = userEvent.setup();
    setStreamState();
    useStore.setState({ agentColors: { a1: 'red' } } as Partial<
      ReturnType<typeof useStore.getState>
    >);
    render(<ActivityFeed />);
    await user.click(screen.getByRole('button', { name: 'All output' }));

    const row = screen
      .getAllByTestId('feed-row')
      .find((r) => r.textContent?.includes('I will start with the use cases'));
    const mark = within(row as HTMLElement).getByTestId('feed-agent-mark');
    expect(mark.style.color).toBe('rgb(255, 107, 107)');
  });
});

describe('ActivityFeed pause', () => {
  it('freezes the visible rows so a live stream can be read', async () => {
    const user = userEvent.setup();
    setStoreState();
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /pause/i }));

    // New output arriving while paused must not move what is on screen.
    useStore.setState({
      agentEvents: {
        ...agentEvents,
        a1: [...agentEvents.a1, { kind: 'run', label: 'Ran pnpm build', at: t3 + 1000 }],
      },
    } as Partial<ReturnType<typeof useStore.getState>>);

    expect(screen.queryByText(/Ran pnpm build/)).not.toBeInTheDocument();
  });

  it('catches back up when resumed', async () => {
    const user = userEvent.setup();
    setStoreState();
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /pause/i }));
    useStore.setState({
      agentEvents: {
        ...agentEvents,
        a1: [...agentEvents.a1, { kind: 'run', label: 'Ran pnpm build', at: t3 + 1000 }],
      },
    } as Partial<ReturnType<typeof useStore.getState>>);
    await user.click(screen.getByRole('button', { name: /resume/i }));

    expect(screen.getByText(/Ran pnpm build/)).toBeInTheDocument();
  });

  it('says it is paused instead of claiming to be live', async () => {
    const user = userEvent.setup();
    setStoreState();
    render(<ActivityFeed />);

    expect(screen.getByTestId('activity-feed-header')).toHaveTextContent('Live');
    await user.click(screen.getByRole('button', { name: /pause/i }));
    expect(screen.getByTestId('activity-feed-header')).toHaveTextContent('Paused');
  });
});

describe('ActivityFeed stored history', () => {
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

  it('shows history from an agent that has already exited', () => {
    // The trap this guards: history is keyed by agents that are gone, so a
    // feed that resolved names against the running fleet would render nothing.
    useStore.setState({ agents, agentEvents, agentLogHistory: history } as Partial<
      ReturnType<typeof useStore.getState>
    >);
    render(<ActivityFeed />);

    expect(screen.getByText('Edited src/old.ts')).toBeInTheDocument();
    expect(screen.getByText(/old-app\/Yesterday/)).toBeInTheDocument();
  });

  it('sorts stored rows below the live ones by time, not by source', () => {
    useStore.setState({ agents, agentEvents, agentLogHistory: history } as Partial<
      ReturnType<typeof useStore.getState>
    >);
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row').map((r) => r.textContent);
    expect(rows[rows.length - 1]).toContain('Edited src/old.ts');
  });

  it('does not show the current session twice when it is also on disk', () => {
    const alsoStored: PersistedAgentEvent[] = [
      {
        agentId: 'a1',
        agentName: 'Waitlist',
        repoPath: '/repos/acme-app',
        kind: 'edit',
        label: 'Edited src/a.ts',
        at: t1,
        seq: 0,
      },
    ];
    useStore.setState({ agents, agentEvents, agentLogHistory: alsoStored } as Partial<
      ReturnType<typeof useStore.getState>
    >);
    render(<ActivityFeed />);

    expect(screen.getAllByText('Edited src/a.ts')).toHaveLength(1);
  });

  it('leaves the output mode alone — history holds events, not raw lines', () => {
    useStore.setState({ agents, agentEvents, agentLogHistory: history } as Partial<
      ReturnType<typeof useStore.getState>
    >);
    render(<ActivityFeed />);
    expect(screen.getByText('Edited src/old.ts')).toBeInTheDocument();
  });
});

/** Everything the feed reads, set in one go — these tests run after describes
 * that leave history and stream lines behind, and a stray row from one of them
 * would silently change what "the row at the top" means. */
function setFeedState(state: {
  agentEvents?: Record<string, AgentEvent[]>;
  agentStreamLines?: Record<string, StreamLine[]>;
}) {
  useStore.setState({
    agents,
    agentEvents: state.agentEvents ?? {},
    agentStreamLines: state.agentStreamLines ?? {},
    agentLogHistory: [],
  } as Partial<ReturnType<typeof useStore.getState>>);
}

describe('ActivityFeed row identity', () => {
  // The feed grows at the FRONT. Keying a row by its position therefore
  // changes every key on every tick: React matches nothing, tears the whole
  // list down and rebuilds it — taking the reader's text selection with it.
  it('keeps the rows already on screen mounted when a newer event arrives', () => {
    setFeedState({ agentEvents });
    render(<ActivityFeed />);

    const askRow = screen
      .getAllByTestId('feed-row')
      .find((r) => r.textContent?.includes('Permission requested'));

    act(() => {
      useStore.setState({
        agentEvents: {
          ...agentEvents,
          a1: [...agentEvents.a1, { kind: 'run', label: 'Ran pnpm build', at: t3 + 1000 }],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    const rows = screen.getAllByTestId('feed-row');
    expect(rows[0]).toHaveTextContent('Ran pnpm build');
    expect(rows[1]).toBe(askRow);
  });

  it('keeps the output lines already on screen mounted when a newer line arrives', async () => {
    const user = userEvent.setup();
    setFeedState({
      agentEvents,
      agentStreamLines: { a1: [{ text: 'Reading the pricing spec', at: t1, seq: 0 }] },
    });
    render(<ActivityFeed />);
    await user.click(screen.getByRole('button', { name: 'All output' }));

    const firstLine = screen.getByTestId('feed-row');

    act(() => {
      useStore.setState({
        agentStreamLines: {
          a1: [
            { text: 'Reading the pricing spec', at: t1, seq: 0 },
            { text: 'Now writing the tests', at: t3, seq: 1 },
          ],
        },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    const rows = screen.getAllByTestId('feed-row');
    expect(rows[0]).toHaveTextContent('Now writing the tests');
    expect(rows[1]).toBe(firstLine);
  });
});

describe('ActivityFeed windowing', () => {
  const base = new Date(2024, 0, 2, 10, 0, 0).getTime();
  const manyEvents: AgentEvent[] = Array.from({ length: 500 }, (_, i) => ({
    kind: 'edit',
    label: `Edited src/file-${i}.ts`,
    at: base - i * 1000,
    seq: 0,
  }));
  const manyLines: StreamLine[] = Array.from({ length: 500 }, (_, i) => ({
    text: `Line ${i}`,
    at: base - i * 1000,
    seq: 500 - i,
  }));

  /** jsdom does no layout, so `scrollTop` has to be planted before the event
   * that makes the component read it. */
  function scrollTo(top: number) {
    const container = screen.getByTestId('feed-scroll');
    Object.defineProperty(container, 'scrollTop', { value: top, configurable: true });
    fireEvent.scroll(container);
  }

  it('renders a windowful of events rather than the whole backlog', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    const rows = screen.getAllByTestId('feed-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]).toHaveTextContent('Edited src/file-0.ts');
    expect(screen.queryByText('Edited src/file-499.ts')).not.toBeInTheDocument();
  });

  it('reveals the older events when the feed is scrolled to the end', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    scrollTo(100_000);

    const rows = screen.getAllByTestId('feed-row');
    expect(rows[rows.length - 1]).toHaveTextContent('Edited src/file-499.ts');
    expect(screen.queryByText('Edited src/file-0.ts')).not.toBeInTheDocument();
  });

  it('windows the raw output stream as well', async () => {
    const user = userEvent.setup();
    setFeedState({ agentStreamLines: { a1: manyLines } });
    render(<ActivityFeed />);
    await user.click(screen.getByRole('button', { name: 'All output' }));

    expect(screen.getAllByTestId('feed-row').length).toBeLessThan(100);
    expect(screen.getByText('Line 0')).toBeInTheDocument();

    scrollTo(100_000);
    expect(screen.getByText('Line 499')).toBeInTheDocument();
  });

  // Windowing is what makes this reachability rather than convenience: with the
  // whole backlog in the DOM, a virtual cursor could walk every row and a pane
  // nobody can focus cost only comfort. With a hundred rows in the DOM, scroll
  // is the only way to the rest — so the pane has to be focusable, and WebKit,
  // which is what Tauri renders with, does not make scroll regions focusable
  // on its own.
  it('puts the feed pane in the tab order, under a name that says what it is', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    const pane = screen.getByRole('region', { name: /activity feed/i });
    expect(pane).toHaveAttribute('tabindex', '0');
    pane.focus();
    expect(pane).toHaveFocus();
  });

  it('moves the window when the focused pane is scrolled by keyboard', () => {
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    const pane = screen.getByRole('region', { name: /activity feed/i });
    pane.focus();
    expect(pane).toHaveFocus();
    fireEvent.keyDown(pane, { key: 'End' });

    // jsdom does no layout and so never scrolls on a keypress; the scroll a
    // browser would produce here is driven by hand. What is being checked is
    // our half of the contract — the window follows the pane's scroll, whatever
    // moved it — and that the keystroke can reach the pane at all.
    scrollTo(100_000);

    const rows = screen.getAllByTestId('feed-row');
    expect(rows[rows.length - 1]).toHaveTextContent('Edited src/file-499.ts');
  });

  it('windows the frozen rows while paused, so pause still holds what was on screen', async () => {
    const user = userEvent.setup();
    setFeedState({ agentEvents: { a1: manyEvents } });
    render(<ActivityFeed />);

    await user.click(screen.getByRole('button', { name: /pause/i }));
    act(() => {
      useStore.setState({
        agentEvents: { a1: [{ kind: 'run', label: 'Ran pnpm build', at: base + 1000 }] },
      } as Partial<ReturnType<typeof useStore.getState>>);
    });

    expect(screen.queryByText('Ran pnpm build')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('feed-row').length).toBeLessThan(100);
    scrollTo(100_000);
    expect(screen.getByText('Edited src/file-499.ts')).toBeInTheDocument();
  });
});
