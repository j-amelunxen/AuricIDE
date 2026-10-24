import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import {
  filterFocusTerminalAgents,
  isFinishedAgent,
  isSupervisorAgent,
  splitFleet,
  supervisorChildSummary,
} from './fleet';

const agent = (
  id: string,
  status: AgentInfo['status'],
  startedAt = 0,
  extra: Partial<AgentInfo> = {}
): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status,
  startedAt,
  ...extra,
});

describe('isFinishedAgent', () => {
  it('counts stopped and failed agents as finished', () => {
    expect(isFinishedAgent(agent('a', 'idle'))).toBe(true);
    expect(isFinishedAgent(agent('a', 'error'))).toBe(true);
  });

  it('does not count working or waiting agents as finished', () => {
    expect(isFinishedAgent(agent('a', 'running'))).toBe(false);
    expect(isFinishedAgent(agent('a', 'queued'))).toBe(false);
  });
});

describe('splitFleet', () => {
  it('separates working agents from finished ones', () => {
    const { active, finished } = splitFleet(
      [agent('a', 'running'), agent('b', 'idle'), agent('c', 'queued')],
      []
    );
    expect(active.map((a) => a.id)).toEqual(['a', 'c']);
    expect(finished.map((a) => a.id)).toEqual(['b']);
  });

  it('puts working agents before queued ones', () => {
    const { active } = splitFleet([agent('q', 'queued', 1), agent('r', 'running', 2)], []);
    expect(active.map((a) => a.id)).toEqual(['r', 'q']);
  });

  it('keeps agents of equal standing in the order they were started', () => {
    // Reordering under the cursor as agents go briefly quiet would be worse
    // than a slightly stale order, so liveness deliberately plays no part.
    const { active } = splitFleet(
      [agent('third', 'running', 300), agent('first', 'running', 100)],
      []
    );
    expect(active.map((a) => a.id)).toEqual(['first', 'third']);
  });

  it('does not reorder when an agent merely goes quiet', () => {
    const quiet = agent('a', 'running', 100, { lastActivityAt: 0 });
    const busy = agent('b', 'running', 200, { lastActivityAt: 999_999 });
    expect(splitFleet([quiet, busy], []).active.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('shows the most recently finished agent first', () => {
    // Finished agents are a review list — the last one to stop is the one
    // you are most likely looking for. When it stopped is what counts; a
    // long-running agent that just failed must not sort as ancient because
    // it started early.
    const { finished } = splitFleet(
      [
        agent('started-late-finished-early', 'idle', 300, { finishedAt: 1_000 }),
        agent('started-early-finished-late', 'error', 100, { finishedAt: 2_000 }),
      ],
      []
    );
    expect(finished.map((a) => a.id)).toEqual([
      'started-early-finished-late',
      'started-late-finished-early',
    ]);
  });

  it('falls back to startedAt for finished agents without a stamp', () => {
    const { finished } = splitFleet([agent('old', 'idle', 100), agent('new', 'error', 300)], []);
    expect(finished.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('pulls parked agents out of both lists', () => {
    const { active, finished, parked } = splitFleet(
      [agent('a', 'running'), agent('b', 'idle')],
      ['a', 'b']
    );
    expect(active).toEqual([]);
    expect(finished).toEqual([]);
    expect(parked.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('ignores parked ids that no longer match an agent', () => {
    const { active, parked } = splitFleet([agent('a', 'running')], ['gone']);
    expect(active.map((a) => a.id)).toEqual(['a']);
    expect(parked).toEqual([]);
  });

  it('keeps parked agents in the order they were parked', () => {
    const { parked } = splitFleet(
      [agent('a', 'running', 100), agent('b', 'running', 200)],
      ['b', 'a']
    );
    expect(parked.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('leaves the input array untouched', () => {
    const input = [agent('b', 'idle', 200), agent('a', 'running', 100)];
    splitFleet(input, []);
    expect(input.map((a) => a.id)).toEqual(['b', 'a']);
  });
});

describe('splitFleet with supervisors', () => {
  const sup = (id: string, status: AgentInfo['status'], startedAt = 0) =>
    agent(id, status, startedAt, { role: 'supervisor' });
  const child = (id: string, parent: string, status: AgentInfo['status'], startedAt = 0) =>
    agent(id, status, startedAt, { spawnedByAgentId: parent });

  it('orders children directly under their supervisor among the cards', () => {
    const { active } = splitFleet(
      [
        sup('s', 'running', 1),
        agent('x', 'running', 2),
        child('c1', 's', 'running', 3),
        agent('y', 'queued', 4),
        child('c2', 's', 'queued', 5),
      ],
      []
    );
    expect(active.map((a) => a.id)).toEqual(['s', 'c1', 'c2', 'x', 'y']);
  });

  it('groups within the finished list too, newest outcome first per level', () => {
    const { finished } = splitFleet(
      [
        { ...sup('s', 'idle'), finishedAt: 10 },
        { ...child('c1', 's', 'idle'), finishedAt: 30 },
        { ...agent('x', 'idle'), finishedAt: 20 },
        { ...child('c2', 's', 'error'), finishedAt: 40 },
      ],
      []
    );
    expect(finished.map((a) => a.id)).toEqual(['x', 's', 'c2', 'c1']);
  });

  it('keeps a child in its own shape when the supervisor is in another one', () => {
    const { active, finished, parked } = splitFleet(
      [
        { ...sup('s', 'idle'), finishedAt: 1 },
        child('c1', 's', 'running'),
        child('c2', 's', 'running'),
      ],
      ['c2']
    );
    expect(finished.map((a) => a.id)).toEqual(['s']);
    expect(active.map((a) => a.id)).toEqual(['c1']);
    expect(parked.map((a) => a.id)).toEqual(['c2']);
  });

  it('never changes how many agents each shape holds', () => {
    const agents = [
      sup('s', 'running'),
      child('c1', 's', 'running'),
      child('orphan', 'gone', 'running'),
      agent('x', 'idle'),
    ];
    const split = splitFleet(agents, []);
    expect(split.active).toHaveLength(3);
    expect(split.finished).toHaveLength(1);
    expect(split.active.map((a) => a.id)).toContain('orphan');
  });
});

describe('supervisorChildSummary', () => {
  it('counts every child and the running ones', () => {
    const agents = [
      agent('s', 'running', 0, { role: 'supervisor' }),
      agent('c1', 'running', 0, { spawnedByAgentId: 's' }),
      agent('c2', 'idle', 0, { spawnedByAgentId: 's' }),
      agent('c3', 'running', 0, { spawnedByAgentId: 'other' }),
    ];
    expect(supervisorChildSummary(agents, 's')).toBe('2 children · 1 running');
    expect(supervisorChildSummary(agents, 'other')).toBe('1 child · 1 running');
    expect(supervisorChildSummary(agents, 'none')).toBe('No children yet');
  });
});

describe('filterFocusTerminalAgents', () => {
  const sup1 = agent('s1', 'running', 1, { role: 'supervisor' });
  const sup2 = agent('s2', 'running', 2, { role: 'supervisor' });
  const child = agent('c1', 'running', 3, { role: 'worker', spawnedByAgentId: 's1' });
  const plain = agent('w1', 'running', 4);

  it('identifies only supervisor-role agents as supervisors', () => {
    expect(isSupervisorAgent(sup1)).toBe(true);
    expect(isSupervisorAgent(child)).toBe(false);
    expect(isSupervisorAgent(plain)).toBe(false);
  });

  it('keeps the full list when focus mode is off', () => {
    const fleet = [sup1, child, sup2, plain];
    expect(filterFocusTerminalAgents(fleet, false)).toBe(fleet);
  });

  it('keeps only supervisors in order when focus mode is on', () => {
    const fleet = [sup1, child, sup2, plain];
    expect(filterFocusTerminalAgents(fleet, true)).toEqual([sup1, sup2]);
  });

  it('leaves the original list intact when focus mode is on but no supervisor exists', () => {
    const workers = [child, plain];
    expect(filterFocusTerminalAgents(workers, true)).toBe(workers);
  });
});
