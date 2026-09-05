import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FeedGroup } from '@/lib/agents/lanes';
import { FeedGroupBlock } from './FeedGroupBlock';

const at = new Date(2024, 0, 1, 14, 55, 0).getTime();

function makeGroup(overrides: Partial<FeedGroup> = {}): FeedGroup {
  return {
    agentId: 'a1',
    agentName: 'Waitlist',
    repoPath: '/repos/acme-app',
    at,
    rows: [{ agentId: 'a1', agentName: 'Waitlist', kind: 'edit', label: 'Edited src/a.ts', at }],
    ...overrides,
  };
}

describe('FeedGroupBlock', () => {
  it('shows the monogram, agent name and project label on the header', () => {
    render(<FeedGroupBlock group={makeGroup()} color="#56ccf2" />);
    const group = screen.getByTestId('feed-group');
    expect(within(group).getByTestId('feed-agent-mark')).toBeInTheDocument();
    expect(group).toHaveTextContent('Waitlist');
    expect(group).toHaveTextContent('acme-app');
  });

  it('falls back to Unknown when the agent has no repo path', () => {
    render(<FeedGroupBlock group={makeGroup({ repoPath: undefined })} color="#56ccf2" />);
    expect(screen.getByTestId('feed-group')).toHaveTextContent('Unknown');
  });

  it('renders one row per row in the group', () => {
    const rows: FeedGroup['rows'] = [
      { agentId: 'a1', agentName: 'Waitlist', kind: 'edit', label: 'Edited src/a.ts', at },
      { agentId: 'a1', agentName: 'Waitlist', kind: 'run', label: 'Ran pnpm lint', at: at + 1000 },
    ];
    render(<FeedGroupBlock group={makeGroup({ rows })} color="#56ccf2" />);
    expect(screen.getAllByTestId('feed-row')).toHaveLength(2);
  });
});
