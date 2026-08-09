import { describe, it, expect } from 'vitest';
import {
  agentAttention,
  needsAttention,
  countNeedingAttention,
  nextAttentionAgentId,
  withReviewFlags,
  sortByUrgency,
  AGENT_STALL_MS,
} from './attention';
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

describe('agentAttention — reviewed failures', () => {
  it('stops counting a failure once its outcome was reviewed', () => {
    // Opening the logs is the acknowledgement: the user has seen it and now
    // owns the decision to retry or dismiss. Keeping the badge lit past that
    // point would make the alarm unquittable — and ignored.
    expect(agentAttention(agent({ status: 'error', reviewed: true }), NOW)).toBeNull();
    expect(agentAttention(agent({ status: 'error', reviewed: false }), NOW)).toBe('error');
    expect(agentAttention(agent({ status: 'error' }), NOW)).toBe('error');
  });

  it('never quiets a running agent through review — there is no outcome yet', () => {
    expect(
      agentAttention(agent({ reviewed: true, lastActivityAt: NOW - AGENT_STALL_MS - 1 }), NOW)
    ).toBe('stalled');
  });
});

describe('withReviewFlags', () => {
  it('marks exactly the reviewed agents', () => {
    const flagged = withReviewFlags(
      [
        { id: 'a', status: 'error' as const, lastActivityAt: undefined },
        { id: 'b', status: 'error' as const, lastActivityAt: undefined },
      ],
      ['b']
    );
    expect(flagged.map((a) => a.reviewed)).toEqual([false, true]);
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

describe('sortByUrgency', () => {
  it('ranks failures over prompts over stalls', () => {
    const fleet = [
      { id: 'stalled', status: 'running' as const, lastActivityAt: NOW - AGENT_STALL_MS - 1 },
      { id: 'blocked', status: 'running' as const, awaitingInput: true, lastActivityAt: NOW },
      { id: 'failed', status: 'error' as const, lastActivityAt: undefined },
    ];
    expect(sortByUrgency(fleet, NOW).map((a) => a.id)).toEqual(['failed', 'blocked', 'stalled']);
  });

  it('puts the longest-ignored failure first', () => {
    const fleet = [
      { id: 'fresh', status: 'error' as const, lastActivityAt: undefined, finishedAt: NOW - 1_000 },
      { id: 'old', status: 'error' as const, lastActivityAt: undefined, finishedAt: NOW - 60_000 },
    ];
    expect(sortByUrgency(fleet, NOW).map((a) => a.id)).toEqual(['old', 'fresh']);
  });

  it('puts the longest-silent stall first', () => {
    const fleet = [
      {
        id: 'briefly',
        status: 'running' as const,
        lastActivityAt: NOW - AGENT_STALL_MS - 1_000,
      },
      {
        id: 'forever',
        status: 'running' as const,
        lastActivityAt: NOW - AGENT_STALL_MS - 600_000,
      },
    ];
    expect(sortByUrgency(fleet, NOW).map((a) => a.id)).toEqual(['forever', 'briefly']);
  });

  it('drops the calm agents entirely', () => {
    const fleet = [
      { id: 'ok', status: 'running' as const, lastActivityAt: NOW },
      { id: 'failed', status: 'error' as const, lastActivityAt: undefined },
    ];
    expect(sortByUrgency(fleet, NOW).map((a) => a.id)).toEqual(['failed']);
  });
});

describe('nextAttentionAgentId', () => {
  const fleet = [
    { id: 'ok', status: 'running' as const, lastActivityAt: NOW },
    { id: 'err-1', status: 'error' as const, lastActivityAt: undefined },
    { id: 'ok-2', status: 'idle' as const, lastActivityAt: undefined },
    { id: 'err-2', status: 'error' as const, lastActivityAt: undefined },
  ];

  it('starts at the first agent needing a human', () => {
    expect(nextAttentionAgentId(fleet, null, NOW)).toBe('err-1');
  });

  it('cycles through the attention set, skipping the calm agents', () => {
    expect(nextAttentionAgentId(fleet, 'err-1', NOW)).toBe('err-2');
    expect(nextAttentionAgentId(fleet, 'err-2', NOW)).toBe('err-1');
  });

  it('treats a selected calm agent like no selection', () => {
    expect(nextAttentionAgentId(fleet, 'ok', NOW)).toBe('err-1');
  });

  it('returns null when nobody needs a human — the shortcut stays inert', () => {
    expect(nextAttentionAgentId([fleet[0]], null, NOW)).toBeNull();
  });
});

describe('stall window sanity', () => {
  it('stays far wider than the live window, so "waiting" exists between live and stalled', () => {
    // Waiting is normal (thinking, long tool calls); stalled is the escalation.
    // If the two windows ever converge, every pause becomes an alarm.
    expect(AGENT_STALL_MS).toBeGreaterThanOrEqual(AGENT_LIVE_WINDOW_MS * 10);
  });
});
