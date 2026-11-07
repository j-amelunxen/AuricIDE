import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { ExternalAgent } from '@/lib/agents/externalAgents';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { buildSupervisorTimeline, type TimelineRangeId } from '@/lib/agents/supervisorTimeline';
import { SupervisorTimelinePanel, SupervisorTimelineToggle } from './SupervisorTimeline';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function agent(partial: Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'name'>): AgentInfo {
  return {
    model: 'opus',
    provider: 'claude',
    status: 'running',
    startedAt: NOW - 10 * MIN,
    lastActivityAt: NOW,
    ...partial,
  };
}

const supervisor = agent({
  id: 'sup',
  name: 'Supervisor',
  role: 'supervisor',
  startedAt: NOW - 20 * MIN,
});
const writer = agent({
  id: 'writer',
  name: 'Writer',
  model: 'sonnet',
  spawnedByAgentId: 'sup',
  startedAt: NOW - 8 * MIN,
  currentTask: 'Draft the pricing page',
});
const failed = agent({
  id: 'ops',
  name: 'Ops',
  status: 'error',
  spawnedByAgentId: 'sup',
  startedAt: NOW - 15 * MIN,
  finishedAt: NOW - 12 * MIN,
  currentTask: 'Sync CRM',
});
const headless = agent({
  id: 'quiet',
  name: 'Quiet',
  headless: true,
  spawnedByAgentId: 'sup',
  startedAt: NOW - 4 * MIN,
});
const earlier = agent({
  id: 'old',
  name: 'Researcher',
  status: 'idle',
  spawnedByAgentId: 'sup',
  startedAt: NOW - 3 * 60 * MIN,
  finishedAt: NOW - 2 * 60 * MIN,
});

const fleet = [supervisor, writer, failed, headless, earlier];

function Panel({ onOpen = vi.fn() }: { onOpen?: (agent: AgentInfo) => void }) {
  const [range, setRange] = useState<TimelineRangeId>('30m');
  const model = buildSupervisorTimeline(fleet, 'sup', NOW, range);
  if (!model) throw new Error('expected a timeline');
  return (
    <SupervisorTimelinePanel
      model={model}
      range={range}
      onRange={setRange}
      now={NOW}
      currentAgentId="sup"
      onOpenAgent={onOpen}
    />
  );
}

describe('SupervisorTimelinePanel', () => {
  it('draws one bar per agent still inside the window, in the fleet’s own colours', () => {
    render(<Panel />);
    expect(screen.getByRole('region', { name: 'Agent timeline' })).toBeInTheDocument();
    expect(screen.getByText('3 running')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bar-writer')).toHaveAttribute('data-tone', 'running');
    expect(screen.getByTestId('timeline-bar-writer')).toHaveTextContent('Draft the pricing page');
    expect(screen.getByTestId('timeline-bar-ops')).toHaveAttribute('data-tone', 'error');
    expect(screen.getByTestId('timeline-bar-sup')).toHaveAttribute('data-tone', 'running');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-row-old')).not.toBeInTheDocument();
    expect(screen.getByText('1 agent is outside this window.')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-handoff-sup-writer')).toBeInTheDocument();
  });

  it('widens the window from the range control', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByTestId('timeline-row-old')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bar-old')).toHaveAttribute('data-tone', 'done');
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText(/outside this window/)).not.toBeInTheDocument();
  });

  it('opens an agent that has a terminal and leaves a headless run as a row only', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Panel onOpen={onOpen} />);

    expect(screen.queryByRole('button', { name: 'Show Quiet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Supervisor' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show Writer' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'writer' }));
  });

  it('says so when the supervisor has not started anyone', () => {
    const model = buildSupervisorTimeline([supervisor], 'sup', NOW, '30m');
    render(
      <SupervisorTimelinePanel
        model={model!}
        range="30m"
        onRange={() => {}}
        now={NOW}
        currentAgentId="sup"
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByText('No agents started yet.')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-row-sup')).toHaveTextContent('Supervisor');
  });
});

describe('SupervisorTimelinePanel: external runs', () => {
  const RUN_DIR = '/tmp/runs/own';
  const owner = agent({
    id: 'sup',
    name: 'Supervisor',
    role: 'supervisor',
    repoPath: RUN_DIR,
    startedAt: NOW - 20 * MIN,
  });

  function external(partial: Partial<ExternalAgent> = {}): ExternalAgent {
    return {
      id: 'ext-1',
      externalId: 'box-7',
      runId: null,
      projectPath: '/tmp/example-project',
      name: 'Fix the parser',
      provider: 'codex',
      model: 'opus',
      ticketId: null,
      ticketName: null,
      goalId: null,
      state: 'running',
      stale: false,
      registeredAt: NOW - 10 * MIN,
      lastSeenAt: NOW - MIN,
      finishedAt: null,
      onSpans: [{ from: NOW - 10 * MIN, to: null }],
      ownerRunDir: RUN_DIR,
      ownerAgentId: 'sup',
      closedBy: null,
      report: null,
      booked: false,
      ...partial,
    };
  }

  function panel(
    externals: ExternalAgent[],
    props: Partial<React.ComponentProps<typeof SupervisorTimelinePanel>> = {},
    fleetNow: AgentInfo[] = [owner]
  ) {
    const model = buildSupervisorTimeline(fleetNow, 'sup', NOW, '30m', externals)!;
    return (
      <SupervisorTimelinePanel
        model={model}
        range="30m"
        onRange={() => {}}
        now={NOW}
        currentAgentId="sup"
        onOpenAgent={() => {}}
        confirm={async () => true}
        onCloseExternal={async () => {}}
        {...props}
      />
    );
  }

  const rowOf = (id = 'ext-1') => screen.getByTestId(`timeline-external-row-${id}`);

  /* testuuid: t_c9ve3yut covers: el_extrow01 categories: happy,negative level: unit */
  it('draws a row that is no button and offers no console', () => {
    render(panel([external()]));
    const row = rowOf();
    expect(row.tagName).toBe('DIV');
    expect(row).toHaveAttribute('data-elementuuid', 'el_extrow01');
    expect(within(row).getByText('External')).toBeInTheDocument();
    // Once as the row's name, once as the label on its bar.
    expect(within(row).getAllByText('Fix the parser')).toHaveLength(2);
    expect(within(row).getByText('opus')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show Fix the parser/ })).toBeNull();
    // The close control is the one button in the row.
    expect(within(row).getAllByRole('button')).toHaveLength(1);
  });

  it('shows no state badge when plainly on, and says what it is in the title', () => {
    render(panel([external()]));
    expect(within(rowOf()).queryByText('Running')).toBeNull();
    expect(rowOf().getAttribute('title')).toBe(
      'Fix the parser · Running · registered 10m, on 10m. Tracked by hand: no console, no kill.'
    );
  });

  it('greys a parked entry: dashed base, no solid time, badge Off', () => {
    const off = external({
      state: 'registered',
      registeredAt: NOW - 25 * MIN,
      onSpans: [],
    });
    render(panel([off]));
    expect(within(rowOf()).getByText('Off')).toBeInTheDocument();
    const bar = screen.getByTestId('timeline-external-bar-ext-1');
    expect(bar).toHaveAttribute('data-tone', 'external-off');
    expect(bar.className).toContain('border-dashed');
    expect(screen.queryAllByTestId('timeline-external-segment-ext-1')).toHaveLength(0);
    expect(rowOf().getAttribute('title')).toContain('Off · registered 25m, on 0s.');
  });

  it('draws an on phase solid and in the same colour tokens as a running bar', () => {
    render(panel([external()]));
    const [segment] = screen.getAllByTestId('timeline-external-segment-ext-1');
    expect(segment.className).toContain('bg-primary/25');
    expect(segment.className).not.toContain('border-dashed');
  });

  it('does not paint an earlier on phase of a parked entry as running', () => {
    render(
      panel([
        external({
          state: 'registered',
          onSpans: [{ from: NOW - 10 * MIN, to: NOW - 5 * MIN }],
        }),
      ])
    );
    const [segment] = screen.getAllByTestId('timeline-external-segment-ext-1');
    expect(segment.className).not.toContain('bg-primary');
  });

  it('reads Stale? in amber past its limit', () => {
    render(panel([external({ lastSeenAt: NOW - 27 * 60 * MIN })]));
    const badge = within(rowOf()).getByText('Stale?');
    expect(badge.className).toContain('amber');
  });

  it('says so when the owner is gone', () => {
    render(panel([external({ ownerRunDir: '/tmp/runs/gone' })]));
    expect(rowOf().getAttribute('title')).toMatch(/Owner gone\.$/);
  });

  it('labels a final entry and offers it no close', () => {
    render(
      panel([
        external({ state: 'stopped', finishedAt: NOW - MIN }),
        external({ id: 'ext-2', state: 'failed', finishedAt: NOW - MIN }),
      ])
    );
    expect(within(rowOf()).getByText('Stopped')).toBeInTheDocument();
    expect(within(rowOf('ext-2')).getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close external run/ })).toBeNull();
  });

  /* testuuid: t_p6ja1rxo covers: el_extcls01 categories: happy,negative level: unit */
  it('asks before closing and closes only on yes', async () => {
    const user = userEvent.setup();
    const onCloseExternal = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    const { rerender } = render(panel([external()], { confirm, onCloseExternal }));

    const button = screen.getByRole('button', { name: 'Close external run Fix the parser' });
    expect(button).toHaveAttribute('data-elementuuid', 'el_extcls01');
    await user.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onCloseExternal).not.toHaveBeenCalled();

    const yes = vi.fn(async () => true);
    rerender(panel([external()], { confirm: yes, onCloseExternal }));
    await user.click(screen.getByRole('button', { name: 'Close external run Fix the parser' }));
    expect(onCloseExternal).toHaveBeenCalledWith('ext-1');
    // A run still heard from ends now: no forced end, no end reason.
    expect(onCloseExternal.mock.calls[0]).toEqual(['ext-1']);
  });

  it('books a stale run as lost at its last sign of life, and says so first', async () => {
    const user = userEvent.setup();
    const lastSeenAt = NOW - 27 * 60 * MIN;
    const stale = external({
      registeredAt: NOW - 30 * 60 * MIN,
      lastSeenAt,
      onSpans: [{ from: NOW - 30 * 60 * MIN, to: null }],
    });
    const onCloseExternal = vi.fn(async () => {});
    const confirm = vi.fn(async (_request: ConfirmRequest) => true);
    render(panel([stale], { confirm, onCloseExternal }));

    await user.click(screen.getByRole('button', { name: 'Close external run Fix the parser' }));
    const shown = new Date(lastSeenAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(confirm.mock.calls[0][0].message).toContain(`last sign of life, ${shown}`);
    expect(onCloseExternal).toHaveBeenCalledWith('ext-1', {
      finishedAt: lastSeenAt,
      endReason: 'lost',
    });
  });

  it('names the end reason in the row title', () => {
    render(panel([external({ state: 'stopped', finishedAt: NOW - MIN, endReason: 'reaped' })]));
    expect(rowOf().getAttribute('title')).toContain('Stopped (reaped)');
  });

  /* testuuid: t_u5ti0bnm covers: el_extcls01 categories: negative level: unit */
  it('says it when closing fails, without tool output', async () => {
    const user = userEvent.setup();
    const onCloseExternal = vi.fn(async () => {
      throw new Error('registry_unreadable: /tmp/secret/path');
    });
    render(panel([external()], { onCloseExternal }));
    await user.click(screen.getByRole('button', { name: 'Close external run Fix the parser' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not close Fix the parser.');
    expect(alert).not.toHaveTextContent('/tmp/secret/path');
  });

  it('counts on entries beside the running figure, and takes data after mount', () => {
    const { rerender } = render(panel([]));
    expect(screen.queryByText(/external$/)).toBeNull();
    rerender(panel([external(), external({ id: 'ext-2', state: 'registered', onSpans: [] })]));
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('1 external')).toBeInTheDocument();
    expect(rowOf('ext-2')).toBeInTheDocument();
  });

  it('does not say no agents started while it has only external runs', () => {
    const { rerender } = render(panel([external()]));
    expect(screen.queryByText('No agents started yet.')).toBeNull();

    const finished = external({
      state: 'stopped',
      registeredAt: NOW - 200 * MIN,
      finishedAt: NOW - 100 * MIN,
      onSpans: [],
    });
    rerender(panel([finished]));
    expect(screen.queryByText('No agents started yet.')).toBeNull();
    expect(screen.getByText('1 external run is outside this window.')).toBeInTheDocument();
  });

  it('scales the hand-off curves over all rows, external ones included', () => {
    const { container } = render(panel([external()]));
    const curves = [...container.querySelectorAll('svg')].find((svg) =>
      svg.getAttribute('viewBox')?.startsWith('0 0 1000')
    );
    expect(curves?.getAttribute('viewBox')).toBe('0 0 1000 2');
  });

  it('adds the external figure to the toggle only when there is one', () => {
    const { rerender } = render(
      <SupervisorTimelineToggle open={false} runningCount={2} onToggle={() => {}} />
    );
    expect(screen.queryByText(/external/)).toBeNull();
    rerender(
      <SupervisorTimelineToggle
        open={false}
        runningCount={2}
        externalCount={3}
        onToggle={() => {}}
      />
    );
    expect(screen.getByText('3 external')).toBeInTheDocument();
  });
});
