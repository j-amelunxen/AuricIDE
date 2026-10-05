import { describe, expect, it } from 'vitest';
import { buildOrchestrationGraph } from './graphBuilder';
import type { PmGoal, PmGoalRun, PmGoalStation } from '../tauri/goals';
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

function makeStation(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Step',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: '',
    updatedAt: '',
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

  it('includes station progress for a goal worked without tickets', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const stations = [
      makeStation({ id: 's1', status: 'done', evidenceKind: 'judged' }),
      makeStation({ id: 's2' }),
      makeStation({ id: 's3', status: 'done', evidenceKind: 'claim' }),
    ];
    const { nodes } = buildOrchestrationGraph(goals, [], [], [], stations);
    expect(nodes.find((n) => n.id === 'goal-g1')?.data.progress).toEqual({ done: 1, total: 3 });
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

describe('buildOrchestrationGraph dependencies', () => {
  function dep(goalId: string, dependsOnGoalId: string) {
    return { id: `${goalId}->${dependsOnGoalId}`, goalId, dependsOnGoalId, createdAt: '' };
  }

  it('draws a dashed dependency edge kept apart from the parent-child tree', () => {
    const goals = [
      makeGoal({ id: 'p' }),
      makeGoal({ id: 'a', parentId: 'p' }),
      makeGoal({ id: 'b', parentId: 'p' }),
    ];
    const { edges } = buildOrchestrationGraph(goals, [], [], [], [], [dep('b', 'a')]);
    const depEdge = edges.find((e) => e.kind === 'dependency');
    expect(depEdge).toEqual(
      expect.objectContaining({ source: 'goal-a', target: 'goal-b', animated: false })
    );
    // b already hangs off its parent through a, so only a keeps its parent edge.
    expect(edges.filter((e) => e.kind === undefined)).toEqual([
      expect.objectContaining({ source: 'goal-p', target: 'goal-a' }),
    ]);
  });

  it('keeps the parent edge of a goal whose prerequisite is not a sibling', () => {
    const goals = [
      makeGoal({ id: 'p' }),
      makeGoal({ id: 'q' }),
      makeGoal({ id: 'a', parentId: 'p' }),
    ];
    const { edges } = buildOrchestrationGraph(goals, [], [], [], [], [dep('a', 'q')]);
    expect(edges).toContainEqual(expect.objectContaining({ source: 'goal-p', target: 'goal-a' }));
  });

  it('drops a dependency edge whose endpoint is not part of the rendered tree', () => {
    const goals = [makeGoal({ id: 'a' })];
    const { edges } = buildOrchestrationGraph(goals, [], [], [], [], [dep('a', 'ghost')]);
    expect(edges.some((e) => e.kind === 'dependency')).toBe(false);
  });

  it('runs a serial chain left to right, the way the sub-goal plan graph does', () => {
    const goals = [
      makeGoal({ id: 'p' }),
      makeGoal({ id: 'c', parentId: 'p', sortOrder: 2 }),
      makeGoal({ id: 'a', parentId: 'p', sortOrder: 0 }),
      makeGoal({ id: 'b', parentId: 'p', sortOrder: 1 }),
    ];
    const dependencies = [dep('b', 'a'), dep('c', 'b')];
    const { nodes } = buildOrchestrationGraph(goals, [], [], [], [], dependencies);
    const colOf = (id: string) => nodes.find((n) => n.id === `goal-${id}`)?.position.x;
    expect(colOf('a')).toBeLessThan(colOf('b') as number);
    expect(colOf('b')).toBeLessThan(colOf('c') as number);
  });

  it('stacks parallel siblings in one column', () => {
    const goals = [
      makeGoal({ id: 'p' }),
      makeGoal({ id: 'a', parentId: 'p' }),
      makeGoal({ id: 'b', parentId: 'p' }),
    ];
    const { nodes } = buildOrchestrationGraph(goals, [], [], []);
    const a = nodes.find((n) => n.id === 'goal-a')!;
    const b = nodes.find((n) => n.id === 'goal-b')!;
    expect(a.position.x).toBe(b.position.x);
    expect(a.position.y).not.toBe(b.position.y);
  });

  it('keeps every node clear of the others on a wide plan with a dependency web', () => {
    const children = Array.from({ length: 18 }, (_, i) =>
      makeGoal({ id: `s${i}`, parentId: 'p', sortOrder: i })
    );
    const goals = [makeGoal({ id: 'p' }), makeGoal({ id: 'q' }), ...children];
    // Every third sibling waits on the one before it; the rest run in parallel.
    const dependencies = children
      .filter((_, i) => i > 0 && i % 3 === 0)
      .map((c, i) => dep(c.id, `s${i * 3 + 2}`));
    const tickets = [makeTicket({ id: 't1', goalId: 's0' }), makeTicket({ id: 't2', goalId: 'q' })];
    const { nodes } = buildOrchestrationGraph(goals, tickets, [], [], [], dependencies);

    // OrchestrationNode is 260 px wide; the layout reserves 64 px of height per node.
    const overlaps = (a: (typeof nodes)[number], b: (typeof nodes)[number]) =>
      Math.abs(a.position.x - b.position.x) < 260 && Math.abs(a.position.y - b.position.y) < 64;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        expect(overlaps(nodes[i], nodes[j]), `${nodes[i].id} overlaps ${nodes[j].id}`).toBe(false);
      }
    }
  });
});
