import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PersistedAgentEvent } from '@/lib/tauri/agentLog';

/**
 * The agent-log history across every layer it touches: the application
 * setting, the store's log flush, the write buffer, and the read-back the
 * console renders.
 *
 * The per-module tests each check one seam. These check the promises that only
 * hold if all of them agree — above all that "off" reaches all the way down to
 * the disk, which no single module can prove on its own.
 */

/** Stands in for the Rust store, so a whole session can be replayed. */
const disk: PersistedAgentEvent[] = [];

const agentLogAppend = vi.fn<(events: PersistedAgentEvent[]) => Promise<void>>(async (events) => {
  disk.push(...events);
});
const agentLogLoad = vi.fn<(limit: number) => Promise<PersistedAgentEvent[]>>(async (limit) =>
  [...disk].sort((a, b) => b.at - a.at || b.seq - a.seq).slice(0, limit)
);
const agentLogPrune = vi.fn<(retentionDays: number, maxRows: number) => Promise<number>>(
  async () => 0
);
const agentLogPurge = vi.fn<() => Promise<void>>(async () => {
  disk.length = 0;
});

vi.mock('@/lib/tauri/agentLog', () => ({
  agentLogAppend: (events: PersistedAgentEvent[]) => agentLogAppend(events),
  agentLogLoad: (limit: number) => agentLogLoad(limit),
  agentLogPrune: (retentionDays: number, maxRows: number) => agentLogPrune(retentionDays, maxRows),
  agentLogPurge: () => agentLogPurge(),
}));

vi.mock('@/lib/tauri/agents', () => ({
  spawnAgent: vi.fn(),
  killAgent: vi.fn(async () => undefined),
  killAgentsForRepo: vi.fn(async () => 0),
  renameAgent: vi.fn(async () => undefined),
  listAgents: vi.fn(async () => []),
  listInterruptedAgents: vi.fn(async () => []),
  resumeInterruptedAgent: vi.fn(),
  discardInterruptedAgent: vi.fn(async () => undefined),
  sendToAgent: vi.fn(async () => undefined),
  listAgentPromptHistory: vi.fn(async () => []),
  recordAgentPromptHistory: vi.fn(async () => undefined),
}));

import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { createAgentSlice, type AgentSlice } from '@/lib/store/agentSlice';
import { mergeFeedRows, toFeedRows } from './feed';
import { resetAgentLogWriter } from './persistence';
import { resetAgentExtractors } from './registry';

const AGENT = {
  id: 'a1',
  name: 'Waitlist',
  model: 'm',
  provider: 'claude',
  status: 'running' as const,
  startedAt: 0,
  repoPath: '/repos/acme-app',
};

let store: StoreApi<AgentSlice>;

/**
 * One agent doing three recognisable things, and then finishing.
 *
 * Nothing here flushes by hand: the writes have to come from the same two
 * places production has — the activity throttle, and the agent stopping.
 */
function runASession() {
  store.setState({ agents: [AGENT] });
  store.getState().appendAgentLog('a1', '⏺ Read(src/a.ts)\n');
  store.getState().appendAgentLog('a1', '⏺ Edit(src/a.ts)\n');
  store.getState().appendAgentLog('a1', '⏺ Bash(pnpm test:run)\n');
  store.getState().updateAgentStatus('a1', 'idle');
}

/** Everything the console's activity feed would render, newest first. */
function renderedFeed() {
  const state = store.getState();
  return mergeFeedRows(toFeedRows(state.agentEvents, state.agents), state.agentLogHistory);
}

beforeEach(() => {
  localStorage.clear();
  disk.length = 0;
  resetAgentLogWriter();
  resetAgentExtractors();
  vi.clearAllMocks();
  store = createStore<AgentSlice>()((...a) => createAgentSlice(...a));
});

afterEach(() => {
  resetAgentLogWriter();
  resetAgentExtractors();
});

const enable = () => localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, 'true');

describe('invariant: off means nothing reaches the disk', () => {
  it('writes nothing through a whole session with the setting off', () => {
    runASession();

    expect(disk).toEqual([]);
    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('still shows the session live, because only the disk is off', () => {
    runASession();
    expect(renderedFeed()).toHaveLength(3);
  });

  it('reads nothing back either, so a stale file could not resurface', async () => {
    disk.push({
      agentId: 'ghost',
      agentName: 'Ghost',
      kind: 'edit',
      label: 'Edited ghost.ts',
      at: 1,
      seq: 0,
    });

    await store.getState().loadAgentLogHistory();

    expect(agentLogLoad).not.toHaveBeenCalled();
    expect(store.getState().agentLogHistory).toEqual([]);
  });
});

describe('invariant: a session survives a restart', () => {
  it('reads back what it wrote', async () => {
    enable();
    runASession();
    expect(disk).toHaveLength(3);

    // A restart: fresh store, fresh extractors, same disk.
    resetAgentExtractors();
    store = createStore<AgentSlice>()((...a) => createAgentSlice(...a));
    await store.getState().loadAgentLogHistory();

    expect(store.getState().agentLogHistory).toHaveLength(3);
    expect(renderedFeed().map((r) => r.label)).toEqual([
      'Ran pnpm test:run',
      'Edited src/a.ts',
      'Read src/a.ts',
    ]);
  });

  it('still names the agent after it is gone', async () => {
    enable();
    runASession();

    store = createStore<AgentSlice>()((...a) => createAgentSlice(...a));
    await store.getState().loadAgentLogHistory();

    // No agents running at all — the rows must still identify themselves.
    expect(store.getState().agents).toEqual([]);
    const rows = renderedFeed();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ agentName: 'Waitlist', repoPath: '/repos/acme-app' });
  });

  it('does not double up the rows that are both live and stored', async () => {
    enable();
    runASession();
    await store.getState().loadAgentLogHistory();

    // Same store, so the session is live AND on disk.
    expect(renderedFeed()).toHaveLength(3);
  });
});

describe('invariant: switching off clears the view as well as the file', () => {
  it('empties both once the setting flips and the history reloads', async () => {
    enable();
    runASession();
    await store.getState().loadAgentLogHistory();
    expect(store.getState().agentLogHistory).toHaveLength(3);

    // What the settings panel does: purge, then turn the setting off.
    await agentLogPurge();
    localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, 'false');
    await store.getState().loadAgentLogHistory();

    expect(disk).toEqual([]);
    expect(store.getState().agentLogHistory).toEqual([]);
  });

  it('stops writing from that moment on', () => {
    enable();
    runASession();
    localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, 'false');
    disk.length = 0;

    // Past the activity throttle, so this chunk carries a flush of its own.
    store.setState({ agents: store.getState().agents.map((a) => ({ ...a, lastActivityAt: 0 })) });
    store.getState().appendAgentLog('a1', '⏺ Edit(src/after.ts)\n');

    expect(disk).toEqual([]);
  });
});

describe('invariant: retention is passed through as configured', () => {
  it('sends the chosen span and the row cap on every load', async () => {
    enable();
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, '30');
    await store.getState().loadAgentLogHistory();

    expect(agentLogPrune).toHaveBeenCalledWith(30, 200_000);
  });

  it('treats "no limit" as an age of zero, never as "keep nothing"', async () => {
    // The failure this rules out is the quiet one: a rotation that reads 0 as
    // "everything is older than nothing" deletes the entire history.
    enable();
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, '0');
    runASession();
    await store.getState().loadAgentLogHistory();

    expect(agentLogPrune).toHaveBeenCalledWith(0, 200_000);
    expect(store.getState().agentLogHistory).toHaveLength(3);
  });

  it('trims before it reads, so nothing on the way out is shown', async () => {
    enable();
    const order: string[] = [];
    agentLogPrune.mockImplementationOnce(async () => {
      order.push('prune');
      return 0;
    });
    agentLogLoad.mockImplementationOnce(async () => {
      order.push('load');
      return [];
    });

    await store.getState().loadAgentLogHistory();

    expect(order).toEqual(['prune', 'load']);
  });
});
