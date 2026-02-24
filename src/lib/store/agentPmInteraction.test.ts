import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import { createPmSlice } from './pmSlice';
import { createUISlice } from './uiSlice';
import type { StoreState } from './index';

vi.mock('../tauri/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnAgent: vi.fn(async (config: any) => ({
    id: 'mock-agent-1',
    name: config.name,
    model: config.model,
    provider: config.provider || 'claude',
    status: 'running' as const,
    currentTask: config.task,
    startedAt: 1000,
    spawnedByTicketId: config.spawnedByTicketId,
  })),
  killAgent: vi.fn(async () => undefined),
  listAgents: vi.fn(async () => []),
}));

vi.mock('../tauri/pm', () => ({
  pmLoad: vi.fn(async () => ({ epics: [], tickets: [], testCases: [], dependencies: [] })),
  pmSave: vi.fn(async () => undefined),
}));

describe('Agent and PM Interaction', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - Partial store for testing (only agent+pm+ui slices)
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createPmSlice(...a),
      ...createUISlice(...a),
    }));
  });

  it('updates ticket status to done when its agent is killed', async () => {
    // 1. Setup a ticket
    const ticket = {
      id: 'ticket-1',
      epicId: 'epic-1',
      name: 'Test Ticket',
      description: 'Desc',
      status: 'in_progress' as const,
      statusUpdatedAt: '',
      priority: 'normal' as const,
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    };
    store.setState({ pmDraftTickets: [ticket] });

    // 2. Spawn an agent for this ticket
    await store.getState().spawnNewAgent({
      name: 'Agent',
      model: 'model',
      task: 'task',
      spawnedByTicketId: 'ticket-1',
    });

    expect(store.getState().agents[0].spawnedByTicketId).toBe('ticket-1');

    // 3. Kill the agent
    await store.getState().killRunningAgent('mock-agent-1');

    // 4. Check if ticket status is 'done'
    const updatedTicket = store.getState().pmDraftTickets.find((t) => t.id === 'ticket-1');
    expect(updatedTicket?.status).toBe('done');
  });
});
