import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
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
