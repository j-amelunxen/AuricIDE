import { describe, expect, it } from 'vitest';
import { buildOrchestrationGraph } from './graphBuilder';
import type { PmGoal, PmGoalRun } from '../tauri/goals';
import type { PmTicket } from '../tauri/pm';
import type { AgentInfo } from '../tauri/agents';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Goal',
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'agent',
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: 0,
    ...overrides,
  };
}

function makeRun(overrides: Partial<PmGoalRun> = {}): PmGoalRun {
  return {
    id: 'r1',
    goalId: 'g1',
    agentId: 'a1',
    ticketId: null,
    prompt: '',
    model: '',
    provider: '',
    source: 'ui',
    outcome: 'running',
    summary: '',
    startedAt: '',
    finishedAt: null,
    ...overrides,
  };
}

describe('buildOrchestrationGraph', () => {
  it('lays out goals by tree depth with parent→child edges', () => {
    const goals = [
      makeGoal({ id: 'root' }),
      makeGoal({ id: 'child', parentId: 'root' }),
      makeGoal({ id: 'grandchild', parentId: 'child', status: 'in_progress' }),
    ];
    const { nodes, edges } = buildOrchestrationGraph(goals, [], [], []);

    const root = nodes.find((n) => n.id === 'goal-root');
    const child = nodes.find((n) => n.id === 'goal-child');
    const grandchild = nodes.find((n) => n.id === 'goal-grandchild');
    expect(root?.position.x).toBe(0);
    expect(child!.position.x).toBeGreaterThan(root!.position.x);
    expect(grandchild!.position.x).toBeGreaterThan(child!.position.x);

    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'goal-root', target: 'goal-child' })
    );
    // in_progress edges are animated
    expect(edges.find((e) => e.target === 'goal-grandchild')?.animated).toBe(true);
  });

  it('includes goal progress from the ticket subtree', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const tickets = [
      makeTicket({ id: 't1', goalId: 'g1', status: 'done' }),
      makeTicket({ id: 't2', goalId: 'g1', status: 'open' }),
    ];
    const { nodes } = buildOrchestrationGraph(goals, tickets, [], []);
    expect(nodes.find((n) => n.id === 'goal-g1')?.data.progress).toEqual({ done: 1, total: 2 });
  });

  it('attaches tickets to their goal and agents to their ticket', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'in_progress' })];
    const agents = [makeAgent({ id: 'a1', spawnedByTicketId: 't1', spawnedByGoalId: 'g1' })];

    const { nodes, edges } = buildOrchestrationGraph(goals, tickets, agents, []);

    expect(nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['goal-g1', 'ticket-t1', 'agent-a1'])
    );
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'goal-g1', target: 'ticket-t1' })
    );
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'ticket-t1', target: 'agent-a1' })
    );
  });

  it('attaches goal-level agents (no ticket) directly to the goal', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const agents = [makeAgent({ id: 'a1', spawnedByGoalId: 'g1' })];
    const { edges } = buildOrchestrationGraph(goals, [], agents, []);
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'goal-g1', target: 'agent-a1' })
    );
  });

  it('falls back to the running goal run for agent attribution', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const agents = [makeAgent({ id: 'a1' })];
    const runs = [makeRun({ agentId: 'a1', goalId: 'g1' })];
    const { nodes, edges } = buildOrchestrationGraph(goals, [], agents, runs);
    expect(nodes.some((n) => n.id === 'agent-a1')).toBe(true);
    expect(edges).toContainEqual(
      expect.objectContaining({ source: 'goal-g1', target: 'agent-a1' })
    );
  });

  it('excludes idle agents and unrelated agents', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const agents = [
      makeAgent({ id: 'idle', status: 'idle', spawnedByGoalId: 'g1' }),
      makeAgent({ id: 'unrelated' }),
    ];
    const { nodes } = buildOrchestrationGraph(goals, [], agents, []);
    expect(nodes.some((n) => n.id.startsWith('agent-'))).toBe(false);
  });

  it('excludes tickets not attached to any goal', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const tickets = [makeTicket({ id: 'free' })];
    const { nodes } = buildOrchestrationGraph(goals, tickets, [], []);
    expect(nodes.some((n) => n.id === 'ticket-free')).toBe(false);
  });
});
