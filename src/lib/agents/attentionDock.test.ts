import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { AGENT_STALL_MS } from './attention';
import { selectAttentionPops } from './attentionDock';

const NOW = 1_700_000_000_000;

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: 'a',
    name: 'Agent',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 500,
    ...overrides,
  };
}

describe('selectAttentionPops', () => {
  it('returns nothing for an empty fleet', () => {
    expect(
      selectAttentionPops({ agents: [], reviewedAgentIds: [], agentEvents: {}, now: NOW })
    ).toEqual([]);
  });

  it('returns nothing while every agent is working calmly', () => {
    expect(
      selectAttentionPops({
        agents: [agent({ id: 'a1', name: 'Calm' })],
        reviewedAgentIds: [],
        agentEvents: {},
        now: NOW,
      })
    ).toEqual([]);
  });

  it('never pops a clean finish — successes do not interrupt', () => {
    expect(
      selectAttentionPops({
        agents: [agent({ id: 'a1', name: 'Done', status: 'idle' })],
        reviewedAgentIds: [],
        agentEvents: {
          a1: [{ kind: 'done', label: 'Finished · 3 files', at: NOW - 1000 }],
        },
        now: NOW,
      })
    ).toEqual([]);
  });

  it('pops an agent waiting on input, using the last ask as the headline', () => {
    const pops = selectAttentionPops({
      agents: [agent({ id: 'a1', name: 'Waitlist', repoPath: '/repos/acme', awaitingInput: true })],
      reviewedAgentIds: [],
      agentEvents: {
        a1: [
          { kind: 'edit', label: 'Edited src/a.ts', at: NOW - 2000 },
          { kind: 'ask', label: 'Permission requested: Bash(pnpm test)', at: NOW - 500 },
        ],
      },
      now: NOW,
    });
    expect(pops).toEqual([
      {
        agentId: 'a1',
        agentName: 'Waitlist',
        repoPath: '/repos/acme',
        reason: 'needs-input',
        headline: 'Permission requested: Bash(pnpm test)',
      },
    ]);
  });

  it('falls back to Waiting on you when there is no ask event yet', () => {
    const pops = selectAttentionPops({
      agents: [agent({ id: 'a1', name: 'Waitlist', awaitingInput: true })],
      reviewedAgentIds: [],
      agentEvents: {},
      now: NOW,
    });
    expect(pops[0]?.headline).toBe('Waiting on you');
  });

  it('pops an unreviewed failure', () => {
    const pops = selectAttentionPops({
      agents: [agent({ id: 'a1', name: 'Broken', status: 'error' })],
      reviewedAgentIds: [],
      agentEvents: {
        a1: [{ kind: 'error', label: 'Crashed on migrate', at: NOW - 200 }],
      },
      now: NOW,
    });
    expect(pops).toEqual([
      {
        agentId: 'a1',
        agentName: 'Broken',
        repoPath: undefined,
        reason: 'error',
        headline: 'Crashed on migrate',
      },
    ]);
  });

  it('drops a failure once it has been reviewed', () => {
    expect(
      selectAttentionPops({
        agents: [agent({ id: 'a1', name: 'Broken', status: 'error' })],
        reviewedAgentIds: ['a1'],
        agentEvents: {
          a1: [{ kind: 'error', label: 'Crashed', at: NOW - 200 }],
        },
        now: NOW,
      })
    ).toEqual([]);
  });

  it('pops a stalled agent', () => {
    const pops = selectAttentionPops({
      agents: [
        agent({
          id: 'a1',
          name: 'Quiet',
          lastActivityAt: NOW - AGENT_STALL_MS - 1,
          currentActivity: 'Running tests',
        }),
      ],
      reviewedAgentIds: [],
      agentEvents: {
        a1: [{ kind: 'run', label: 'Ran pnpm test', at: NOW - AGENT_STALL_MS - 1 }],
      },
      now: NOW,
    });
    expect(pops).toHaveLength(1);
    expect(pops[0].reason).toBe('stalled');
    expect(pops[0].headline).toContain('Ran pnpm test');
  });

  it('orders failures before prompts before stalls', () => {
    const pops = selectAttentionPops({
      agents: [
        agent({
          id: 'stall',
          name: 'Stall',
          lastActivityAt: NOW - AGENT_STALL_MS - 1,
        }),
        agent({ id: 'ask', name: 'Ask', awaitingInput: true }),
        agent({ id: 'fail', name: 'Fail', status: 'error' }),
      ],
      reviewedAgentIds: [],
      agentEvents: {},
      now: NOW,
    });
    expect(pops.map((p) => p.agentId)).toEqual(['fail', 'ask', 'stall']);
  });
});
