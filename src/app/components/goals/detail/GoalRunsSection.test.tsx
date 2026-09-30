import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usageRow } from '@/lib/pm/usage/testRow';
import type { PmGoalRun } from '@/lib/tauri/goals';
import { GoalRunsSection } from './GoalRunsSection';

const run = (agentId: string): PmGoalRun => ({
  id: `run-${agentId}`,
  goalId: 'g1',
  agentId,
  ticketId: null,
  prompt: 'p',
  model: 'm',
  provider: 'claude',
  source: 'ui',
  outcome: 'completed',
  summary: '',
  startedAt: '2026-09-29',
  finishedAt: null,
});

describe('GoalRunsSection cost', () => {
  it('shows the cost of a run whose agent has a usage row, once the row arrives', () => {
    const runs = [run('a1'), run('a2')];
    const { rerender } = render(<GoalRunsSection goalRuns={runs} labelCls="" />);
    expect(screen.queryByText('$1.20')).toBeNull();

    rerender(
      <GoalRunsSection
        goalRuns={runs}
        labelCls=""
        usageRows={[usageRow({ agentId: 'a1', costUsd: 1.2 })]}
      />
    );
    expect(screen.getAllByText('$1.20')).toHaveLength(1);
  });

  it('shows a dash for a run with usage but no price', () => {
    render(
      <GoalRunsSection
        goalRuns={[run('a1')]}
        labelCls=""
        usageRows={[usageRow({ agentId: 'a1', costUsd: null, costSource: 'none' })]}
      />
    );
    expect(screen.getByText('—')).toBeDefined();
  });
});
