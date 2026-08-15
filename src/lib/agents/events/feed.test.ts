import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../tauri/agents';
import { mergeActivityFeed } from './feed';
import type { AgentEvent } from './types';

const agent = (id: string): AgentInfo => ({
  id,
  name: id,
  status: 'running',
  model: 'x',
  provider: 'claude',
  startedAt: 0,
});

const event = (
  kind: AgentEvent['kind'],
  at: number,
  label: string = kind,
  seq: number = 0
): AgentEvent => ({
  kind,
  label,
  at,
  seq,
});

describe('mergeActivityFeed', () => {
  it('interleaves events from multiple agents newest first', () => {
    const feed = mergeActivityFeed({ a: [event('run', 1)], b: [event('edit', 2)] }, [
      agent('a'),
      agent('b'),
    ]);
    expect(feed.map((e) => e.agentId)).toEqual(['b', 'a']);
  });

  it('keeps agent-list order for events sharing the same timestamp', () => {
    const feed = mergeActivityFeed({ a: [event('run', 5)], b: [event('edit', 5)] }, [
      agent('a'),
      agent('b'),
    ]);
    expect(feed.map((e) => e.agentId)).toEqual(['a', 'b']);
  });

  it('caps the feed at the given limit, keeping the newest', () => {
    const events = Array.from({ length: 5 }, (_, i) => event('run', i));
    const feed = mergeActivityFeed({ a: events }, [agent('a')], 2);
    expect(feed.map((e) => e.at)).toEqual([4, 3]);
  });

  it('skips agents with no recorded events', () => {
    expect(mergeActivityFeed({}, [agent('a')])).toEqual([]);
  });

  it("carries each event's own fields alongside the agent id", () => {
    const feed = mergeActivityFeed({ a: [event('edit', 1, 'Edited src/x.ts')] }, [agent('a')]);
    expect(feed[0]).toEqual({
      kind: 'edit',
      label: 'Edited src/x.ts',
      at: 1,
      seq: 0,
      agentId: 'a',
    });
  });

  it('ignores agents referenced in agentEvents but no longer in the agent list', () => {
    const feed = mergeActivityFeed({ gone: [event('run', 1)] }, []);
    expect(feed).toEqual([]);
  });

  it('breaks a same-timestamp tie within one agent by seq, newest seq first', () => {
    // A single PTY chunk commonly produces several events stamped with the
    // identical `at` — without a seq tiebreaker they'd come out oldest-first
    // inside a feed that is supposed to read newest-first.
    const feed = mergeActivityFeed(
      { a: [event('read', 5, 'Read a', 0), event('edit', 5, 'Edited a', 1)] },
      [agent('a')]
    );
    expect(feed.map((e) => e.label)).toEqual(['Edited a', 'Read a']);
  });

  it('still falls back to agent-list order when both at and seq tie', () => {
    const feed = mergeActivityFeed(
      { a: [event('run', 5, 'Ran a', 0)], b: [event('edit', 5, 'Edited b', 0)] },
      [agent('a'), agent('b')]
    );
    expect(feed.map((e) => e.agentId)).toEqual(['a', 'b']);
  });
});
