import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { isFinishedAgent, splitFleet } from './fleet';

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
