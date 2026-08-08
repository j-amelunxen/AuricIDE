import { describe, it, expect } from 'vitest';
import { agentAttention, needsAttention, countNeedingAttention, AGENT_STALL_MS } from './attention';
import { AGENT_LIVE_WINDOW_MS } from './liveness';

const NOW = 1_000_000_000;

const agent = (overrides: Partial<Parameters<typeof agentAttention>[0]> = {}) => ({
  status: 'running' as const,
  lastActivityAt: NOW,
  ...overrides,
});

describe('agentAttention', () => {
  it('flags a failed agent', () => {
    expect(agentAttention(agent({ status: 'error' }), NOW)).toBe('error');
  });

  it('is calm about an agent that is streaming output', () => {
    expect(agentAttention(agent({ lastActivityAt: NOW - 1_000 }), NOW)).toBeNull();
  });

  it('is calm about a briefly quiet agent — thinking is not stalling', () => {
    const quietFor = AGENT_LIVE_WINDOW_MS + 1_000;
    expect(agentAttention(agent({ lastActivityAt: NOW - quietFor }), NOW)).toBeNull();
  });

  it('flags an agent that has been silent past the stall window', () => {
    expect(agentAttention(agent({ lastActivityAt: NOW - AGENT_STALL_MS - 1 }), NOW)).toBe(
      'stalled'
    );
  });

  it('does not flag a running agent with no recorded activity yet', () => {
    // A fresh agent has produced nothing; its silence starts at launch, and
    // judging it stalled before it ever spoke would cry wolf on every spawn.
    expect(agentAttention(agent({ lastActivityAt: undefined }), NOW)).toBeNull();
  });

  it('is calm about done and queued agents — they ask nothing of you', () => {
    expect(agentAttention(agent({ status: 'idle' }), NOW)).toBeNull();
    expect(agentAttention(agent({ status: 'queued' }), NOW)).toBeNull();
  });
});

describe('agentAttention — needs input', () => {
  it('flags an agent whose output waits on a human, even while it looks live', () => {
    // Permission menus redraw themselves, keeping lastActivityAt fresh — a
    // blocked agent that looks busy is exactly what must not slip through.
    expect(agentAttention(agent({ awaitingInput: true, lastActivityAt: NOW }), NOW)).toBe(
      'needs-input'
    );
  });

  it('ranks a failure above a prompt', () => {
    expect(agentAttention(agent({ status: 'error', awaitingInput: true }), NOW)).toBe('error');
  });

  it('ranks a prompt above a stall — it is the more actionable reason', () => {
    expect(
      agentAttention(agent({ awaitingInput: true, lastActivityAt: NOW - AGENT_STALL_MS - 1 }), NOW)
    ).toBe('needs-input');
  });

  it('ignores awaitingInput on an agent that already stopped', () => {
    expect(agentAttention(agent({ status: 'idle', awaitingInput: true }), NOW)).toBeNull();
  });
});

describe('needsAttention / countNeedingAttention', () => {
  it('counts exactly the agents with a reason', () => {
    const fleet = [
      agent({ status: 'error' }),
      agent({ lastActivityAt: NOW - AGENT_STALL_MS - 1 }),
      agent({ lastActivityAt: NOW }),
      agent({ status: 'idle' }),
    ];
    expect(fleet.map((a) => needsAttention(a, NOW))).toEqual([true, true, false, false]);
    expect(countNeedingAttention(fleet, NOW)).toBe(2);
  });
});

describe('stall window sanity', () => {
  it('stays far wider than the live window, so "waiting" exists between live and stalled', () => {
    // Waiting is normal (thinking, long tool calls); stalled is the escalation.
    // If the two windows ever converge, every pause becomes an alarm.
    expect(AGENT_STALL_MS).toBeGreaterThanOrEqual(AGENT_LIVE_WINDOW_MS * 10);
  });
});
