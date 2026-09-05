import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../tauri/agents';
import type { SentMessage } from '../../store/agentSlice';
import {
  mergeActivityFeed,
  mergeFeedRows,
  mergeStreamFeed,
  toFeedRows,
  toSentFeedRows,
  type FeedRow,
} from './feed';
import type { PersistedAgentEvent } from '../../tauri/agentLog';
import type { StreamLine } from './streamCapture';
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

describe('mergeStreamFeed', () => {
  const line = (text: string, at: number, seq = 0): StreamLine => ({ text, at, seq });

  it('interleaves several agents newest first', () => {
    const feed = mergeStreamFeed(
      { a: [line('a-old', 1), line('a-new', 5)], b: [line('b-mid', 3)] },
      [agent('a'), agent('b')]
    );
    expect(feed.map((l) => l.text)).toEqual(['a-new', 'b-mid', 'a-old']);
  });

  it('tags every line with the agent it came from', () => {
    const feed = mergeStreamFeed({ a: [line('hello', 1)] }, [agent('a')]);
    expect(feed[0]).toMatchObject({ agentId: 'a', text: 'hello', at: 1 });
  });

  it('breaks a same-timestamp tie by seq, newest first', () => {
    // One PTY chunk yields several lines with the identical `at`; without the
    // seq tiebreaker a newest-first stream would print them backwards.
    const feed = mergeStreamFeed({ a: [line('first', 5, 0), line('second', 5, 1)] }, [agent('a')]);
    expect(feed.map((l) => l.text)).toEqual(['second', 'first']);
  });

  it('ignores lines for agents that are no longer tracked', () => {
    expect(mergeStreamFeed({ gone: [line('orphan', 1)] }, [])).toEqual([]);
  });

  it('keeps only the newest lines up to the limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(`line-${i}`, i));
    const feed = mergeStreamFeed({ a: lines }, [agent('a')], 3);
    expect(feed.map((l) => l.text)).toEqual(['line-49', 'line-48', 'line-47']);
  });

  it('handles an agent with no captured output yet', () => {
    expect(mergeStreamFeed({}, [agent('a')])).toEqual([]);
  });

  it('orders the same moment the way the curated feed does', () => {
    // The two modes must not disagree about what came first, or switching
    // between them would look like the history changed.
    const events = mergeActivityFeed(
      { a: [event('run', 5, 'Ran a', 0)], b: [event('edit', 5, 'Edited b', 0)] },
      [agent('a'), agent('b')]
    );
    const stream = mergeStreamFeed({ a: [line('Ran a', 5, 0)], b: [line('Edited b', 5, 0)] }, [
      agent('a'),
      agent('b'),
    ]);
    expect(stream.map((l) => l.agentId)).toEqual(events.map((e) => e.agentId));
  });
});

describe('toFeedRows', () => {
  const ev = (label: string, at: number, seq = 0): AgentEvent => ({ kind: 'run', label, at, seq });

  it('resolves the live agent list into rows that carry their own identity', () => {
    const rows = toFeedRows({ a: [ev('Ran build', 5)] }, [
      { ...agent('a'), name: 'Builder', repoPath: '/repos/acme' },
    ]);
    expect(rows[0]).toMatchObject({
      agentId: 'a',
      agentName: 'Builder',
      repoPath: '/repos/acme',
      label: 'Ran build',
    });
  });

  it('falls back to the id when an agent has no name yet', () => {
    const rows = toFeedRows({ a: [ev('Ran build', 5)] }, [{ ...agent('a'), name: '' }]);
    expect(rows[0].agentName).toBe('a');
  });
});

describe('toSentFeedRows', () => {
  const message = (text: string, at: number, seq = 0): SentMessage => ({ text, at, seq });

  it('turns a sent message into a "sent"-kind row carrying the agent identity', () => {
    const rows = toSentFeedRows({ a: [message('run the tests', 5)] }, [
      { ...agent('a'), name: 'Builder', repoPath: '/repos/acme' },
    ]);
    expect(rows).toEqual([
      {
        agentId: 'a',
        agentName: 'Builder',
        repoPath: '/repos/acme',
        kind: 'sent',
        label: 'run the tests',
        at: 5,
        seq: 0,
      },
    ]);
  });

  it('falls back to the id when an agent has no name yet', () => {
    const rows = toSentFeedRows({ a: [message('hi', 1)] }, [{ ...agent('a'), name: '' }]);
    expect(rows[0].agentName).toBe('a');
  });

  it('emits one row per sent message, in the order they were sent', () => {
    const rows = toSentFeedRows({ a: [message('first', 1, 0), message('second', 2, 1)] }, [
      agent('a'),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['first', 'second']);
  });

  it('skips agents with no sent messages', () => {
    expect(toSentFeedRows({}, [agent('a')])).toEqual([]);
  });

  it('ignores messages for agents no longer in the fleet', () => {
    expect(toSentFeedRows({ gone: [message('orphan', 1)] }, [])).toEqual([]);
  });
});

describe('mergeFeedRows', () => {
  const live = (agentId: string, at: number, seq = 0, label = 'live'): FeedRow => ({
    agentId,
    agentName: agentId,
    kind: 'run',
    label,
    at,
    seq,
  });
  const stored = (agentId: string, at: number, seq = 0, label = 'stored'): PersistedAgentEvent => ({
    agentId,
    agentName: agentId,
    kind: 'run',
    label,
    at,
    seq,
  });

  it('interleaves stored history with live events, newest first', () => {
    const rows = mergeFeedRows([live('a', 10)], [stored('old', 5)]);
    expect(rows.map((r) => r.at)).toEqual([10, 5]);
  });

  it('shows history from agents that no longer exist', () => {
    // The whole reason this function exists: a stored row carries its own
    // name and repo, so it survives the agent it came from being gone.
    const rows = mergeFeedRows([], [stored('vanished', 5)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe('vanished');
  });

  it('prefers the live row when the same event is in both', () => {
    // Everything live was also written to disk. Without dedupe the feed would
    // show the current session twice.
    const rows = mergeFeedRows([live('a', 10, 1, 'live')], [stored('a', 10, 1, 'stored')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('live');
  });

  it('treats the same timestamp from different agents as different events', () => {
    const rows = mergeFeedRows([live('a', 10, 0)], [stored('b', 10, 0)]);
    expect(rows).toHaveLength(2);
  });

  it('treats the same timestamp with a different seq as different events', () => {
    const rows = mergeFeedRows([live('a', 10, 0)], [stored('a', 10, 1)]);
    expect(rows).toHaveLength(2);
  });

  it('caps the result at the limit, keeping the newest', () => {
    const many = Array.from({ length: 20 }, (_, i) => live('a', i, i));
    expect(mergeFeedRows(many, [], 3).map((r) => r.at)).toEqual([19, 18, 17]);
  });

  it('is just the live rows when there is no stored history', () => {
    const rows = mergeFeedRows([live('a', 10), live('a', 5)], []);
    expect(rows.map((r) => r.at)).toEqual([10, 5]);
  });

  it('is just the history when nothing is running', () => {
    expect(mergeFeedRows([], [stored('a', 5)])).toHaveLength(1);
  });

  it('does not let a sent row shadow a stored event sharing the same (agent, at, seq)', () => {
    // Sent messages carry their own seq space, per agent, starting at 0 —
    // exactly like AgentEvent's. mergeFeedRows dedupes stored history against
    // whatever is already live by (agentId, at, seq); without a kind-aware
    // row key, a sent row at seq 0 would look identical to a stored *event*
    // row with that same seq, and the real event would be silently dropped
    // as if it were the sent message already accounted for.
    const sent: FeedRow = {
      agentId: 'a',
      agentName: 'a',
      kind: 'sent',
      label: 'go',
      at: 10,
      seq: 0,
    };
    const rows = mergeFeedRows([sent], [stored('a', 10, 0, 'Edited a')]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.label).sort()).toEqual(['Edited a', 'go']);
  });
});
