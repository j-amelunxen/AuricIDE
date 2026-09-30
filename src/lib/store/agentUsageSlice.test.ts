import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';
import { usageRow } from '@/lib/pm/usage/testRow';

const mockLoad = vi.fn();

vi.mock('../tauri/agentUsage', () => ({
  agentUsageLoad: (projectPath: string) => mockLoad(projectPath),
}));

import {
  createAgentUsageSlice,
  selectAgentUsageRows,
  type AgentUsageSlice,
} from './agentUsageSlice';

function createTestStore() {
  return createStore<AgentUsageSlice>()((...a) => ({ ...createAgentUsageSlice(...a) }));
}

describe('agentUsageSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts empty, and an unknown project selects one stable empty list', () => {
    const state = createTestStore().getState();
    expect(selectAgentUsageRows(state, '/p')).toEqual([]);
    expect(selectAgentUsageRows(state, '/p')).toBe(selectAgentUsageRows(state, '/other'));
    expect(selectAgentUsageRows(state, null)).toBe(selectAgentUsageRows(state, '/p'));
  });

  it('loads the rows of the project it asked for, and only that project', async () => {
    const rows = [usageRow({ id: 'a' })];
    mockLoad.mockResolvedValue(rows);
    const store = createTestStore();

    await store.getState().loadAgentUsage('/p');

    expect(mockLoad).toHaveBeenCalledWith('/p');
    expect(selectAgentUsageRows(store.getState(), '/p')).toEqual(rows);
    expect(selectAgentUsageRows(store.getState(), '/q')).toEqual([]);
    expect(store.getState().agentUsageStatus['/p']).toBe('ready');
  });

  it('shows loading while the request is in flight', async () => {
    let resolve: (rows: unknown[]) => void = () => {};
    mockLoad.mockReturnValue(new Promise((r) => (resolve = r)));
    const store = createTestStore();

    const pending = store.getState().loadAgentUsage('/p');
    expect(store.getState().agentUsageStatus['/p']).toBe('loading');
    resolve([]);
    await pending;

    expect(store.getState().agentUsageStatus['/p']).toBe('ready');
  });

  it('keeps the rows it had and reports an error when the load fails', async () => {
    const store = createTestStore();
    store.getState().appendAgentUsage('/p', usageRow({ id: 'a' }));
    mockLoad.mockRejectedValue(new Error('no backend'));

    await store.getState().loadAgentUsage('/p');

    expect(store.getState().agentUsageStatus['/p']).toBe('error');
    expect(selectAgentUsageRows(store.getState(), '/p').map((r) => r.id)).toEqual(['a']);
  });

  it('appends a recorded run newest first', () => {
    const store = createTestStore();
    store
      .getState()
      .appendAgentUsage('/p', usageRow({ id: 'old', finishedAt: '2026-09-01T00:00:00Z' }));
    store
      .getState()
      .appendAgentUsage('/p', usageRow({ id: 'new', finishedAt: '2026-09-02T00:00:00Z' }));

    expect(selectAgentUsageRows(store.getState(), '/p').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('appending the same run twice keeps one copy', () => {
    const store = createTestStore();
    store.getState().appendAgentUsage('/p', usageRow({ id: 'a', costUsd: 1 }));
    store.getState().appendAgentUsage('/p', usageRow({ id: 'a', costUsd: 2 }));

    const rows = selectAgentUsageRows(store.getState(), '/p');
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(2);
  });

  it('a run recorded while a load is in flight survives the load', async () => {
    let resolve: (rows: unknown[]) => void = () => {};
    mockLoad.mockReturnValue(new Promise((r) => (resolve = r)));
    const store = createTestStore();

    const pending = store.getState().loadAgentUsage('/p');
    store
      .getState()
      .appendAgentUsage('/p', usageRow({ id: 'live', finishedAt: '2026-09-03T00:00:00Z' }));
    resolve([usageRow({ id: 'stored', finishedAt: '2026-09-01T00:00:00Z' })]);
    await pending;

    expect(selectAgentUsageRows(store.getState(), '/p').map((r) => r.id)).toEqual([
      'live',
      'stored',
    ]);
  });
});
