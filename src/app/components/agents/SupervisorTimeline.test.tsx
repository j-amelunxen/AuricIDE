import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { buildSupervisorTimeline, type TimelineRangeId } from '@/lib/agents/supervisorTimeline';
import { SupervisorTimelinePanel } from './SupervisorTimeline';

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
