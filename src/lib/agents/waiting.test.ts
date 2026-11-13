import { createTestStore as createFullTestStore } from '@/lib/store/testing';
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from './types';
import { AGENT_STALL_MS, agentAttention } from './attention';
import { agentState } from './state';
import { activeWaiting, waitingLabel } from './waiting';

const NOW = 1_800_000_000_000;
const mark = {
  agentId: 'a',
  reason: 'deploy',
  untilMs: NOW + 3_600_000,
  markedAtMs: NOW - 600_000,
};

/** Quiet for ten minutes: past the stall window, so a plain agent reads "stalled". */
const quiet = {
  status: 'running' as const,
  lastActivityAt: NOW - 10 * 60_000,
  headless: false,
};
const parked = { ...quiet, lastActivityAt: NOW - 10 * 60_000 - 1, waiting: { ...mark } };

describe('an agent parked on purpose', () => {
  it('is the control: the same silence without a mark is a stall', () => {
    expect(NOW - quiet.lastActivityAt).toBeGreaterThan(AGENT_STALL_MS);
    expect(agentAttention(quiet, NOW)).toBe('stalled');
  });

  it('raises no stall and reads as a calm "waiting"', () => {
    expect(agentAttention(parked, NOW)).toBeNull();
    const info = { ...parked, id: 'a', name: 'A', model: 'm', provider: 'claude', startedAt: 1 };
    expect(agentState(info as AgentInfo, NOW)).toBe('waiting');
  });

  it('stalls again once the mark has run out', () => {
    expect(agentAttention(parked, mark.untilMs)).toBe('stalled');
    expect(activeWaiting(parked, mark.untilMs)).toBeNull();
  });

  it('stalls again once the agent printed something after the mark', () => {
    const spoke = { ...parked, lastActivityAt: mark.markedAtMs + 1 };
    expect(activeWaiting(spoke, NOW)).toBeNull();
    expect(agentAttention(spoke, NOW)).toBe('stalled');
  });

  it('still surfaces a question: needs-input beats the mark', () => {
    expect(agentAttention({ ...parked, awaitingInput: true }, NOW)).toBe('needs-input');
  });

  it('names the reason and the end time on the card', () => {
    const label = waitingLabel('deploy', mark.untilMs);
    expect(label).toMatch(/^waiting: deploy \(until \d{2}:\d{2}\)$/);
  });
});

describe('applyAgentWaiting', () => {
  const agent = (id: string): AgentInfo => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status: 'running',
    startedAt: 1,
  });

  it('stamps a mark on its agent, drops it when gone, and writes nothing when unchanged', () => {
    const store = createFullTestStore();
    store.setState({ agents: [agent('a'), agent('b')] });
    const marks = [{ ...mark }];
    store.getState().applyAgentWaiting(marks);
    expect(store.getState().agents[0].waiting?.reason).toBe('deploy');
    expect(store.getState().agents[1].waiting).toBeUndefined();

    const before = store.getState().agents;
    store.getState().applyAgentWaiting([{ ...mark }]);
    expect(store.getState().agents).toBe(before);

    store.getState().applyAgentWaiting([]);
    expect(store.getState().agents[0].waiting).toBeUndefined();
  });
});
