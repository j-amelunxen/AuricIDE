import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalStation } from '../tauri/goals';
import type { PmDependency, PmTicket } from '../tauri/pm';
import type { AgentInfo } from '../tauri/agents';
import { buildForYouQueue, type ForYouInput } from './forYou';

let seq = 0;
const uid = (prefix: string): string => `${prefix}-${++seq}`;
const TS = '2026-01-10 10:00:00';
const NOW = Date.parse('2026-01-10T12:00:00');

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: uid('goal'),
    parentId: null,
    name: 'A goal',
    description: '',
    successCriteria: 'done',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: uid('ticket'),
    epicId: 'epic-1',
    name: 'A ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: TS,
    sortOrder: 0,
    priority: 'normal',
    goalId: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: uid('agent'),
    name: 'worker',
    status: 'running',
    model: 'model-a',
    provider: 'provider-a',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 1_000,
    ...overrides,
  };
}

function makeStation(goalId: string, overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: uid('station'),
    goalId,
    name: 'A station',
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
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

const humanStation = (goalId: string, overrides: Partial<PmGoalStation> = {}) =>
  makeStation(goalId, {
    kind: 'human',
    evidenceKind: 'human',
    predicate: { type: 'human' },
    ...overrides,
  });

function makeInput(overrides: Partial<ForYouInput> = {}): ForYouInput {
  return {
    goals: [],
    tickets: [],
    dependencies: [],
    requirements: [],
    requirementLinks: [],
    stations: [],
    runs: [],
    agents: [],
    reviewedAgentIds: [],
    now: NOW,
    ...overrides,
  };
}

describe('buildForYouQueue', () => {
  it('ranks failed agents, then waiting agents, then approvals, then unclaimed, then stalled', () => {
    const goal = makeGoal();
    const readyTicket = makeTicket({ goalId: goal.id }); // ready work, no agent
    const approvalTicket = makeTicket({ goalId: goal.id, needsHumanSupervision: true });
    const failed = makeAgent({ status: 'error', name: 'crashed', finishedAt: NOW - 500 });
    const waiting = makeAgent({ awaitingInput: true, name: 'asker' });
    const stalled = makeAgent({ name: 'quiet', lastActivityAt: NOW - 500_000 });

    const items = buildForYouQueue(
      makeInput({
        goals: [goal],
        tickets: [readyTicket, approvalTicket],
        agents: [stalled, waiting, failed],
      })
    );
    const kinds = items.map((i) => (i.kind === 'agent' ? i.reason : i.kind));
    expect(kinds).toEqual(['error', 'needs-input', 'approval', 'unclaimed', 'stalled']);
  });

  it('excludes reviewed failures', () => {
    const failed = makeAgent({ status: 'error', finishedAt: NOW - 500 });
    const items = buildForYouQueue(makeInput({ agents: [failed], reviewedAgentIds: [failed.id] }));
    expect(items).toHaveLength(0);
  });

  it('resolves an agent goal through its spawning ticket', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const waiting = makeAgent({ awaitingInput: true, spawnedByTicketId: ticket.id });
    const items = buildForYouQueue(
      makeInput({ goals: [goal], tickets: [ticket], agents: [waiting] })
    );
    const agentItem = items.find((i) => i.kind === 'agent');
    expect(agentItem?.goalId).toBe(goal.id);
  });

  it('only reports approvals for unblocked open supervision tickets', () => {
    const goal = makeGoal();
    const blocker = makeTicket({ goalId: goal.id, status: 'open' });
    const blocked = makeTicket({
      goalId: goal.id,
      status: 'open',
      needsHumanSupervision: true,
    });
    const dep: PmDependency = {
      id: uid('dep'),
      sourceType: 'ticket',
      sourceId: blocked.id,
      targetType: 'ticket',
      targetId: blocker.id,
    };
    // A running agent on the line suppresses the unclaimed item, isolating approvals.
    const busy = makeAgent({ spawnedByGoalId: goal.id });
    const items = buildForYouQueue(
      makeInput({
        goals: [goal],
        tickets: [blocker, blocked],
        dependencies: [dep],
        agents: [busy],
      })
    );
    expect(items.filter((i) => i.kind === 'approval')).toHaveLength(0);
  });

  it('reports an unclaimed line only when ready work has no running agent', () => {
    const idleGoal = makeGoal({ name: 'Idle line' });
    const busyGoal = makeGoal({ name: 'Busy line' });
    const idleWork = makeTicket({ goalId: idleGoal.id });
    const busyWork = makeTicket({ goalId: busyGoal.id });
    const busyAgent = makeAgent({ spawnedByGoalId: busyGoal.id });
    const items = buildForYouQueue(
      makeInput({
        goals: [idleGoal, busyGoal],
        tickets: [idleWork, busyWork],
        agents: [busyAgent],
      })
    );
    const unclaimed = items.filter((i) => i.kind === 'unclaimed');
    expect(unclaimed).toHaveLength(1);
    expect(unclaimed[0].goalId).toBe(idleGoal.id);
  });

  it('is empty when everything is quiet and claimed', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const healthy = makeAgent({ spawnedByTicketId: ticket.id });
    const items = buildForYouQueue(
      makeInput({ goals: [goal], tickets: [ticket], agents: [healthy] })
    );
    expect(items).toHaveLength(0);
  });
});

describe('one problem, one row', () => {
  it('does not list a line as unclaimed when its failed agent already fills a row', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const failed = makeAgent({
      status: 'error',
      spawnedByTicketId: ticket.id,
      finishedAt: NOW - 5_000,
    });
    const items = buildForYouQueue(
      makeInput({ goals: [goal], tickets: [ticket], agents: [failed] })
    );
    expect(items.filter((i) => i.kind === 'unclaimed')).toHaveLength(0);
    expect(items.filter((i) => i.kind === 'agent')).toHaveLength(1);
  });

  describe('human stations', () => {
    const humanItems = (input: ForYouInput) =>
      buildForYouQueue(input).filter((i) => i.kind === 'human-station');

    it('lists an open human station once the agent work before it is done', () => {
      const goal = makeGoal({ name: 'Voice' });
      const test = humanStation(goal.id, { name: 'Test the speakers', sortOrder: 1 });
      const stations = [
        makeStation(goal.id, { status: 'done', evidenceKind: 'judged', sortOrder: 0 }),
        test,
        makeStation(goal.id, { name: 'Review', status: 'done', sortOrder: 2 }),
      ];
      expect(humanItems(makeInput({ goals: [goal], stations }))).toEqual([
        {
          kind: 'human-station',
          stationId: test.id,
          goalId: goal.id,
          label: '"Test the speakers" needs you',
        },
      ]);
    });

    it('does not list a human station while agent work before it is open', () => {
      const goal = makeGoal();
      const stations = [
        makeStation(goal.id, { sortOrder: 0 }),
        humanStation(goal.id, { sortOrder: 1 }),
      ];
      expect(humanItems(makeInput({ goals: [goal], stations }))).toEqual([]);
    });

    it('does not list a human station a person already ticked', () => {
      const goal = makeGoal();
      const stations = [humanStation(goal.id, { status: 'done' })];
      expect(humanItems(makeInput({ goals: [goal], stations }))).toEqual([]);
    });

    it('does not call a line that only waits for a person unclaimed', () => {
      const goal = makeGoal();
      const stations = [
        makeStation(goal.id, { status: 'done', evidenceKind: 'judged', sortOrder: 0 }),
        humanStation(goal.id, { sortOrder: 1 }),
      ];
      const queue = buildForYouQueue(makeInput({ goals: [goal], stations }));
      expect(queue.map((i) => i.kind)).toEqual(['human-station']);
    });

    it('ranks after approvals and before stalls', () => {
      const goal = makeGoal();
      const other = makeGoal();
      const gateTicket = makeTicket({ goalId: other.id, needsHumanSupervision: true });
      const stalled = makeAgent({ lastActivityAt: NOW - 24 * 60 * 60_000 });
      const queue = buildForYouQueue(
        makeInput({
          goals: [goal, other],
          tickets: [gateTicket],
          stations: [humanStation(goal.id)],
          agents: [stalled],
        })
      );
      const kinds = queue.map((i) => i.kind);
      expect(kinds.indexOf('human-station')).toBeGreaterThan(kinds.indexOf('approval'));
      expect(kinds.indexOf('human-station')).toBeLessThan(kinds.lastIndexOf('agent'));
    });
  });
});
