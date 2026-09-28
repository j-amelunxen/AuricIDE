import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { PmTicket } from '@/lib/tauri/pm';
import type { AgentInfo } from '@/lib/tauri/agents';

// Mission Control stays on screen while agents work. Agents rewrite the
// `agents` array every few seconds and tickets on every MCP update, so a row
// that re-renders on either is a list of hundreds re-rendered all day.
const chipRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../pm/TicketStatusChip', () => ({
  TicketStatusChip: () => {
    chipRenders.count++;
    return null;
  },
}));

import { MissionControl } from './MissionControl';

function ticket(id: string, overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id,
    epicId: 'e1',
    name: `Ticket ${id}`,
    description: '',
    status: 'open',
    statusUpdatedAt: '2026-01-01',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function agent(lastActivityAt: number): AgentInfo {
  return { id: 'a1', name: 'Agent', status: 'running', lastActivityAt } as unknown as AgentInfo;
}

describe('MissionControl re-renders', () => {
  const tickets = [ticket('t1'), ticket('t2'), ticket('t3')];

  beforeEach(() => {
    useStore.setState({
      rootPath: '/tmp/demo-project',
      allFilePaths: [],
      pmDraftTickets: tickets,
      requirementsDraft: [],
      goalsDraft: [],
      agents: [agent(1)],
    });
    render(<MissionControl />);
    chipRenders.count = 0;
  });

  it('does not re-render ticket rows when an agent only reports activity', () => {
    act(() => useStore.setState({ agents: [agent(2)] }));
    expect(chipRenders.count).toBe(0);
  });

  it('re-renders only the ticket that changed', () => {
    act(() =>
      useStore.setState({
        pmDraftTickets: [tickets[0], ticket('t2', { status: 'in_progress' }), tickets[2]],
      })
    );
    expect(chipRenders.count).toBe(1);
  });
});
