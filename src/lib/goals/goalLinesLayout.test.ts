import { describe, expect, it } from 'vitest';
import type { PmGoal, PmGoalRequirementLink, PmGoalRun } from '../tauri/goals';
import type { PmDependency, PmTicket } from '../tauri/pm';
import type { PmRequirement } from '../tauri/requirements';
import type { AgentInfo } from '../tauri/agents';
import {
  buildGoalLine,
  buildGoalLines,
  stationIndexForX,
  type GoalLinesInput,
} from './goalLinesLayout';

// --- Fixture factories (generic names only) ---

let seq = 0;
const uid = (prefix: string): string => `${prefix}-${++seq}`;

const TS = '2026-01-10 10:00:00';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: uid('goal'),
    parentId: null,
    name: 'Checkout flow works',
    description: '',
    successCriteria: 'All checkout tickets done',
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

function makeRequirement(overrides: Partial<PmRequirement> = {}): PmRequirement {
  return {
    id: uid('req'),
    reqId: 'REQ-GEN-01',
    title: 'A requirement',
    description: '',
    type: 'functional',
    category: 'general',
    priority: 'normal',
    status: 'active',
    rationale: '',
    acceptanceCriteria: '',
    source: '',
    lastVerifiedAt: null,
    appliesTo: [],
    sortOrder: 0,
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
    startedAt: 1000,
    ...overrides,
  };
}

function makeLink(goalId: string, requirementId: string): PmGoalRequirementLink {
  return { id: uid('link'), goalId, requirementId, createdAt: TS };
}

function makeRun(goalId: string, overrides: Partial<PmGoalRun> = {}): PmGoalRun {
  return {
    id: uid('run'),
    goalId,
    agentId: 'agent-x',
    ticketId: null,
    prompt: '',
    model: 'model-a',
    provider: 'provider-a',
    source: 'ui',
    outcome: 'completed',
    summary: '',
    startedAt: TS,
    finishedAt: '2026-01-10 11:00:00',
    ...overrides,
  };
}

function makeInput(overrides: Partial<GoalLinesInput> = {}): GoalLinesInput {
  return {
    goals: [],
    tickets: [],
    dependencies: [],
    requirements: [],
    requirementLinks: [],
    stations: [],
    runs: [],
    agents: [],
    now: Date.parse('2026-01-10T12:00:00'),
    ...overrides,
  };
}

describe('buildGoalLines', () => {
  it('excludes goals with nothing attached', () => {
    const goal = makeGoal();
    const lines = buildGoalLines(makeInput({ goals: [goal] }));
    expect(lines).toHaveLength(0);
  });

  it('excludes archived goals even with attached work', () => {
    const goal = makeGoal({ status: 'archived' });
    const ticket = makeTicket({ goalId: goal.id });
    const lines = buildGoalLines(makeInput({ goals: [goal], tickets: [ticket] }));
    expect(lines).toHaveLength(0);
  });

  it('builds one line per root goal with attached work', () => {
    const a = makeGoal({ name: 'Alpha' });
    const b = makeGoal({ name: 'Beta' });
    const bare = makeGoal({ name: 'Bare' });
    const lines = buildGoalLines(
      makeInput({
        goals: [a, b, bare],
        tickets: [makeTicket({ goalId: a.id }), makeTicket({ goalId: b.id })],
      })
    );
    expect(lines.map((l) => l.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('includes subtree tickets on the root line', () => {
    const root = makeGoal();
    const child = makeGoal({ parentId: root.id, status: 'achieved' });
    const ticket = makeTicket({ goalId: child.id, name: 'Child work' });
    const [line] = buildGoalLines(makeInput({ goals: [root, child], tickets: [ticket] }));
    expect(line.stations.some((s) => s.ticketId === ticket.id)).toBe(true);
  });
});

describe('station ordering and states', () => {
  it('orders done → front → planned, with the terminus last', () => {
    const goal = makeGoal();
    const done = makeTicket({ goalId: goal.id, status: 'done', name: 'Done work' });
    const front = makeTicket({ goalId: goal.id, status: 'in_progress', name: 'Now' });
    const planned = makeTicket({ goalId: goal.id, status: 'open', name: 'Next' });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [planned, front, done] }),
      goal.id
    );
    expect(line).not.toBeNull();
    const states = line!.stations.map((s) => s.state);
    expect(states).toEqual(['done', 'front', 'planned', 'planned']); // last is terminus
    expect(line!.stations.at(-1)!.kind).toBe('terminus');
  });

  it('sorts done tickets by statusUpdatedAt ascending', () => {
    const goal = makeGoal();
    const older = makeTicket({
      goalId: goal.id,
      status: 'done',
      name: 'Older',
      statusUpdatedAt: '2026-01-09 08:00:00',
    });
    const newer = makeTicket({
      goalId: goal.id,
      status: 'done',
      name: 'Newer',
      statusUpdatedAt: '2026-01-10 09:00:00',
    });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [newer, older] }), goal.id)!;
    const doneLabels = line.stations
      .filter((s) => s.state === 'done' && s.kind !== 'terminus')
      .map((s) => s.label);
    expect(doneLabels).toEqual(['Older', 'Newer']);
  });

  it('orders open unblocked tickets by priority then sortOrder', () => {
    const goal = makeGoal();
    const low = makeTicket({ goalId: goal.id, priority: 'low', sortOrder: 0, name: 'Low' });
    const critical = makeTicket({
      goalId: goal.id,
      priority: 'critical',
      sortOrder: 5,
      name: 'Critical',
    });
    const normalA = makeTicket({
      goalId: goal.id,
      priority: 'normal',
      sortOrder: 1,
      name: 'Normal A',
    });
    const normalB = makeTicket({
      goalId: goal.id,
      priority: 'normal',
      sortOrder: 2,
      name: 'Normal B',
    });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [low, normalB, critical, normalA] }),
      goal.id
    )!;
    const plannedLabels = line.stations
      .filter((s) => s.state === 'planned' && s.kind !== 'terminus')
      .map((s) => s.label);
    expect(plannedLabels).toEqual(['Critical', 'Normal A', 'Normal B', 'Low']);
  });

  it('marks blocked tickets as fog and names the blocker', () => {
    const goal = makeGoal();
    const blocker = makeTicket({ goalId: goal.id, name: 'Foundation', status: 'open' });
    const blocked = makeTicket({ goalId: goal.id, name: 'Roof', status: 'open' });
    const dep: PmDependency = {
      id: uid('dep'),
      sourceType: 'ticket',
      sourceId: blocked.id,
      targetType: 'ticket',
      targetId: blocker.id,
    };
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [blocker, blocked], dependencies: [dep] }),
      goal.id
    )!;
    const fogStation = line.stations.find((s) => s.ticketId === blocked.id)!;
    expect(fogStation.state).toBe('fog');
    expect(fogStation.detail).toContain('Foundation');
  });

  it('a dependency on a done ticket does not block', () => {
    const goal = makeGoal();
    const doneBlocker = makeTicket({ goalId: goal.id, status: 'done' });
    const open = makeTicket({ goalId: goal.id, status: 'open' });
    const dep: PmDependency = {
      id: uid('dep'),
      sourceType: 'ticket',
      sourceId: open.id,
      targetType: 'ticket',
      targetId: doneBlocker.id,
    };
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [doneBlocker, open], dependencies: [dep] }),
      goal.id
    )!;
    expect(line.stations.find((s) => s.ticketId === open.id)!.state).toBe('planned');
  });

  it('excludes archived tickets entirely', () => {
    const goal = makeGoal();
    const archived = makeTicket({ goalId: goal.id, status: 'archived' });
    const open = makeTicket({ goalId: goal.id, status: 'open' });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [archived, open] }), goal.id)!;
    expect(line.stations.some((s) => s.ticketId === archived.id)).toBe(false);
  });

  it('excludes discarded tickets entirely', () => {
    const goal = makeGoal();
    const discarded = makeTicket({ goalId: goal.id, status: 'discarded' });
    const open = makeTicket({ goalId: goal.id, status: 'open' });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [discarded, open] }), goal.id)!;
    expect(line.stations.some((s) => s.ticketId === discarded.id)).toBe(false);
  });
});

describe('evidence classes', () => {
  it('draws agent-done tickets as claims', () => {
    const goal = makeGoal();
    const done = makeTicket({ goalId: goal.id, status: 'done' });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [done] }), goal.id)!;
    expect(line.stations.find((s) => s.ticketId === done.id)!.evidence).toBe('claim');
  });

  it('renders linked requirements as gates before the terminus', () => {
    const goal = makeGoal();
    const req = makeRequirement({ title: 'Invariant holds', status: 'verified' });
    const ticket = makeTicket({ goalId: goal.id, status: 'open' });
    const line = buildGoalLine(
      makeInput({
        goals: [goal],
        tickets: [ticket],
        requirements: [req],
        requirementLinks: [makeLink(goal.id, req.id)],
      }),
      goal.id
    )!;
    const gate = line.stations.find((s) => s.requirementId === req.id)!;
    expect(gate.kind).toBe('gate');
    expect(gate.state).toBe('done');
    expect(gate.detail).toContain('stamped');
    // gate sits after all ticket stations, right before the terminus
    expect(line.stations.indexOf(gate)).toBe(line.stations.length - 2);
  });

  it('renders unverified linked requirements as planned gates', () => {
    const goal = makeGoal();
    const req = makeRequirement({ status: 'active' });
    const line = buildGoalLine(
      makeInput({
        goals: [goal],
        requirements: [req],
        requirementLinks: [makeLink(goal.id, req.id)],
      }),
      goal.id
    )!;
    const gate = line.stations.find((s) => s.requirementId === req.id)!;
    expect(gate.state).toBe('planned');
  });

  it('marks open supervision tickets as gates', () => {
    const goal = makeGoal();
    const gated = makeTicket({ goalId: goal.id, needsHumanSupervision: true });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [gated] }), goal.id)!;
    expect(line.stations.find((s) => s.ticketId === gated.id)!.kind).toBe('gate');
  });
});

describe('geometry', () => {
  it('x is strictly increasing along the line and terminus is at 1', () => {
    const goal = makeGoal();
    const tickets = [
      makeTicket({ goalId: goal.id, status: 'done', statusUpdatedAt: '2026-01-08 08:00:00' }),
      makeTicket({ goalId: goal.id, status: 'done', statusUpdatedAt: '2026-01-09 08:00:00' }),
      makeTicket({ goalId: goal.id, status: 'in_progress' }),
      makeTicket({ goalId: goal.id, status: 'open', sortOrder: 1 }),
      makeTicket({ goalId: goal.id, status: 'open', sortOrder: 2 }),
    ];
    const line = buildGoalLine(makeInput({ goals: [goal], tickets }), goal.id)!;
    const xs = line.stations.map((s) => s.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
    expect(xs.at(-1)).toBe(1);
  });
});

describe('agents perched', () => {
  it('perches running agents on their spawning ticket', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const running = makeAgent({ spawnedByTicketId: ticket.id });
    const idle = makeAgent({ spawnedByTicketId: ticket.id, status: 'idle' });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [ticket], agents: [running, idle] }),
      goal.id
    )!;
    const station = line.stations.find((s) => s.ticketId === ticket.id)!;
    expect(station.agentIds).toEqual([running.id]);
  });

  it('perches goal-level agents on the front station', () => {
    const goal = makeGoal();
    const front = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const planned = makeTicket({ goalId: goal.id, status: 'open' });
    const agent = makeAgent({ spawnedByGoalId: goal.id });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [front, planned], agents: [agent] }),
      goal.id
    )!;
    expect(line.stations.find((s) => s.ticketId === front.id)!.agentIds).toContain(agent.id);
    expect(line.stations.find((s) => s.ticketId === planned.id)!.agentIds).not.toContain(agent.id);
  });
});

describe('last / now / next and satisfaction', () => {
  it('derives last, now, and next from the ordered stations', () => {
    const goal = makeGoal();
    const done = makeTicket({ goalId: goal.id, status: 'done', name: 'Done work' });
    const front = makeTicket({ goalId: goal.id, status: 'in_progress', name: 'Now work' });
    const planned = makeTicket({ goalId: goal.id, status: 'open', name: 'Next work' });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [done, front, planned] }),
      goal.id
    )!;
    expect(line.lastDone?.label).toBe('Done work');
    expect(line.now?.label).toBe('Now work');
    expect(line.next?.label).toBe('Next work');
  });

  it('reports satisfaction through getGoalSatisfaction, not a re-derivation', () => {
    const goal = makeGoal();
    const done = makeTicket({ goalId: goal.id, status: 'done' });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [done] }), goal.id)!;
    expect(line.satisfied).toBe(true);
    expect(line.stations.at(-1)!.state).toBe('done');
  });

  it('lists blockers verbatim when unsatisfied', () => {
    const goal = makeGoal();
    const open = makeTicket({ goalId: goal.id, status: 'open', name: 'Missing piece' });
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [open] }), goal.id)!;
    expect(line.satisfied).toBe(false);
    expect(line.blockers.join(' ')).toContain('Missing piece');
  });
});

describe('idleSince', () => {
  it('is undefined while a running agent works the line', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const agent = makeAgent({ spawnedByTicketId: ticket.id });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [ticket], agents: [agent] }),
      goal.id
    )!;
    expect(line.idleSince).toBeUndefined();
  });

  it('is the newest signal when nothing runs', () => {
    const goal = makeGoal();
    const ticket = makeTicket({
      goalId: goal.id,
      status: 'done',
      statusUpdatedAt: '2026-01-10 09:00:00',
    });
    const run = makeRun(goal.id, { finishedAt: '2026-01-10 11:00:00' });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [ticket], runs: [run] }),
      goal.id
    )!;
    expect(line.idleSince).toBe(Date.parse('2026-01-10 11:00:00'.replace(' ', 'T')));
  });
});

describe('station-backed lines', () => {
  function makeStation(
    goalId: string,
    overrides: Partial<import('../tauri/goals').PmGoalStation> = {}
  ): import('../tauri/goals').PmGoalStation {
    return {
      id: uid('st'),
      goalId,
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
      createdAt: TS,
      updatedAt: TS,
      ...overrides,
    };
  }

  it('renders stored stations instead of tickets when the goal has them', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, name: 'Raw ticket' });
    const station = makeStation(goal.id, { name: 'Planned step' });
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [ticket], stations: [station] }),
      goal.id
    )!;
    expect(line.stations.some((s) => s.label === 'Planned step')).toBe(true);
    expect(line.stations.some((s) => s.label === 'Raw ticket')).toBe(false);
  });

  it('derives the front: first non-done station', () => {
    const goal = makeGoal();
    const stations = [
      makeStation(goal.id, { name: 'Done', status: 'done', sortOrder: 0 }),
      makeStation(goal.id, { name: 'Front', sortOrder: 1 }),
      makeStation(goal.id, { name: 'Later', sortOrder: 2 }),
    ];
    const line = buildGoalLine(makeInput({ goals: [goal], stations }), goal.id)!;
    expect(line.stations.map((s) => s.state)).toEqual([
      'done',
      'front',
      'planned',
      'planned', // terminus
    ]);
    expect(line.now?.label).toBe('Front');
  });

  it('a station whose linked ticket is in progress is also front', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const stations = [
      makeStation(goal.id, { name: 'A', sortOrder: 0 }),
      makeStation(goal.id, { name: 'Working', sortOrder: 1, ticketId: ticket.id }),
    ];
    const line = buildGoalLine(makeInput({ goals: [goal], tickets: [ticket], stations }), goal.id)!;
    expect(line.stations.find((s) => s.label === 'Working')!.state).toBe('front');
  });

  it('keeps stored fog as fog and surfaces the undefined-check debt', () => {
    const goal = makeGoal();
    const stations = [
      makeStation(goal.id, { name: 'Someday', status: 'fog', sortOrder: 1 }),
      makeStation(goal.id, { name: 'Now', sortOrder: 0 }),
    ];
    const line = buildGoalLine(makeInput({ goals: [goal], stations }), goal.id)!;
    const fog = line.stations.find((s) => s.label === 'Someday')!;
    expect(fog.state).toBe('fog');
    expect(line.stations.find((s) => s.label === 'Now')!.detail).toContain('check to be defined');
  });

  it('perches agents on station-backed lines via the linked ticket', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const agent = makeAgent({ spawnedByTicketId: ticket.id });
    const stations = [makeStation(goal.id, { ticketId: ticket.id })];
    const line = buildGoalLine(
      makeInput({ goals: [goal], tickets: [ticket], stations, agents: [agent] }),
      goal.id
    )!;
    expect(line.stations[0].agentIds).toContain(agent.id);
  });

  it('uses the raw station id so reorder targets resolve', () => {
    const goal = makeGoal();
    const station = makeStation(goal.id);
    const line = buildGoalLine(makeInput({ goals: [goal], stations: [station] }), goal.id)!;
    expect(line.stations[0].id).toBe(station.id);
  });
});

describe('stationIndexForX', () => {
  it('counts stations left of the drop point, excluding self and terminus', () => {
    const goal = makeGoal();
    const stations = [
      { ...baseStation(goal.id), id: 'a', sortOrder: 0 },
      { ...baseStation(goal.id), id: 'b', sortOrder: 1 },
      { ...baseStation(goal.id), id: 'c', sortOrder: 2 },
    ];
    const line = buildGoalLine(makeInput({ goals: [goal], stations }), goal.id)!;
    // Drop far right: c (excluded) sees a and b to its left → index 2
    expect(stationIndexForX(line, 0.99, 'c')).toBe(2);
    // Drop far left → index 0
    expect(stationIndexForX(line, 0.0, 'c')).toBe(0);
  });

  function baseStation(goalId: string): import('../tauri/goals').PmGoalStation {
    return {
      id: uid('st'),
      goalId,
      name: 'Step',
      kind: 'human',
      status: 'planned',
      evidenceKind: 'human',
      predicate: { type: 'human' },
      evidenceNote: '',
      ticketId: null,
      lane: 0,
      sortOrder: 0,
      lastCheckedAt: null,
      doneAt: null,
      createdAt: TS,
      updatedAt: TS,
    };
  }
});
