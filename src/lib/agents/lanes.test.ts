import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import type { FeedRow } from './events/feed';
import type { AgentEvent } from './events/types';
import {
  buildLanes,
  FOLLOW_SLACK_PX,
  feedTier,
  groupBySender,
  isNearBottom,
  isVisibleUnderMute,
  laneUnread,
  oldestFirst,
  SENDER_RUN_MAX_GAP_MS,
} from './lanes';

const agent = (id: string, overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: id,
  status: 'running',
  model: 'x',
  provider: 'claude',
  startedAt: 0,
  ...overrides,
});

const row = (overrides: Partial<FeedRow> & Pick<FeedRow, 'agentId' | 'kind' | 'at'>): FeedRow => ({
  agentName: overrides.agentId,
  label: overrides.kind,
  ...overrides,
});

describe('feedTier', () => {
  it('reads an ask as a mention', () => {
    expect(feedTier('ask')).toBe('mention');
  });

  it('reads done and error as outcomes', () => {
    expect(feedTier('done')).toBe('outcome');
    expect(feedTier('error')).toBe('outcome');
  });

  it('reads a note as prose', () => {
    expect(feedTier('note')).toBe('prose');
  });

  it('reads read, edit and run as system lines', () => {
    expect(feedTier('read')).toBe('system');
    expect(feedTier('edit')).toBe('system');
    expect(feedTier('run')).toBe('system');
  });

  it("reads a sent message as the user's own", () => {
    expect(feedTier('sent')).toBe('you');
  });
});

describe('oldestFirst', () => {
  it('sorts ascending by at', () => {
    const rows = [
      row({ agentId: 'a', kind: 'run', at: 3 }),
      row({ agentId: 'a', kind: 'run', at: 1 }),
    ];
    expect(oldestFirst(rows).map((r) => r.at)).toEqual([1, 3]);
  });

  it('breaks a tied at by seq, ascending', () => {
    const rows = [
      { at: 5, seq: 2 },
      { at: 5, seq: 0 },
      { at: 5, seq: 1 },
    ];
    expect(oldestFirst(rows).map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  it('does not mutate the input array', () => {
    const rows = [
      { at: 3, seq: 0 },
      { at: 1, seq: 0 },
    ];
    const original = [...rows];
    oldestFirst(rows);
    expect(rows).toEqual(original);
  });

  it('returns a new array even when already sorted', () => {
    const rows = [{ at: 1 }, { at: 2 }];
    expect(oldestFirst(rows)).not.toBe(rows);
  });
});

describe('groupBySender', () => {
  it('returns an empty array for empty input', () => {
    expect(groupBySender([])).toEqual([]);
  });

  it('groups consecutive rows from the same agent into one run', () => {
    const rows = [
      row({ agentId: 'a', kind: 'read', at: 1 }),
      row({ agentId: 'a', kind: 'edit', at: 2 }),
    ];
    const groups = groupBySender(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].at).toBe(1);
  });

  it('starts a new group when the sender changes', () => {
    const rows = [
      row({ agentId: 'a', kind: 'read', at: 1 }),
      row({ agentId: 'b', kind: 'edit', at: 2 }),
      row({ agentId: 'a', kind: 'run', at: 3 }),
    ];
    const groups = groupBySender(rows);
    expect(groups.map((g) => g.agentId)).toEqual(['a', 'b', 'a']);
  });

  it('carries the sender identity onto the group', () => {
    const rows = [
      row({ agentId: 'a', agentName: 'Builder', repoPath: '/repo', kind: 'run', at: 1 }),
    ];
    const groups = groupBySender(rows);
    expect(groups[0]).toMatchObject({ agentId: 'a', agentName: 'Builder', repoPath: '/repo' });
  });

  it('breaks a run when the gap between rows exceeds the max silence', () => {
    const rows = [
      row({ agentId: 'a', kind: 'read', at: 0 }),
      row({ agentId: 'a', kind: 'edit', at: SENDER_RUN_MAX_GAP_MS + 1 }),
    ];
    const groups = groupBySender(rows);
    expect(groups).toHaveLength(2);
  });

  it('keeps one run when the gap is exactly at the boundary', () => {
    const rows = [
      row({ agentId: 'a', kind: 'read', at: 0 }),
      row({ agentId: 'a', kind: 'edit', at: SENDER_RUN_MAX_GAP_MS }),
    ];
    const groups = groupBySender(rows);
    expect(groups).toHaveLength(1);
  });
});

describe('isVisibleUnderMute', () => {
  it('shows every row from an unmuted agent', () => {
    const r = row({ agentId: 'a', kind: 'read', at: 1 });
    expect(isVisibleUnderMute(r, [])).toBe(true);
  });

  it('hides a system row from a muted agent', () => {
    const r = row({ agentId: 'a', kind: 'read', at: 1 });
    expect(isVisibleUnderMute(r, ['a'])).toBe(false);
  });

  it('hides prose from a muted agent', () => {
    const r = row({ agentId: 'a', kind: 'note', at: 1 });
    expect(isVisibleUnderMute(r, ['a'])).toBe(false);
  });

  it('still shows a question from a muted agent', () => {
    const r = row({ agentId: 'a', kind: 'ask', at: 1 });
    expect(isVisibleUnderMute(r, ['a'])).toBe(true);
  });

  it('still shows an outcome from a muted agent', () => {
    const r = row({ agentId: 'a', kind: 'done', at: 1 });
    expect(isVisibleUnderMute(r, ['a'])).toBe(true);
  });
});

describe('laneUnread', () => {
  const ev = (at: number): AgentEvent => ({ kind: 'run', label: 'run', at });

  it('counts every event when there is no seen mark', () => {
    expect(laneUnread([ev(1), ev(2)], undefined)).toBe(2);
  });

  it('counts only events newer than the seen mark', () => {
    expect(laneUnread([ev(1), ev(2), ev(3)], 2)).toBe(1);
  });

  it('is zero once everything is at or before the seen mark', () => {
    expect(laneUnread([ev(1), ev(2)], 2)).toBe(0);
  });

  it('is zero for no events at all', () => {
    expect(laneUnread([], undefined)).toBe(0);
  });
});

describe('isNearBottom', () => {
  it('is near the bottom when scrolled all the way down', () => {
    expect(isNearBottom(100, 50, 150)).toBe(true);
  });

  it('is near the bottom within the slack', () => {
    expect(isNearBottom(100 - FOLLOW_SLACK_PX, 50, 150)).toBe(true);
  });

  it('is not near the bottom just past the slack', () => {
    expect(isNearBottom(100 - FOLLOW_SLACK_PX - 1, 50, 150)).toBe(false);
  });

  it('is not near the bottom when scrolled to the top of a long feed', () => {
    expect(isNearBottom(0, 50, 1000)).toBe(false);
  });
});

describe('buildLanes', () => {
  const baseInput = (overrides: Partial<Parameters<typeof buildLanes>[0]> = {}) => ({
    agents: [] as AgentInfo[],
    agentEvents: {},
    agentColors: {},
    reviewedAgentIds: [],
    mutedAgentIds: [],
    laneSeenAt: {},
    now: 1_000,
    ...overrides,
  });

  it('builds one lane per agent', () => {
    const lanes = buildLanes(baseInput({ agents: [agent('a'), agent('b')] }));
    expect(lanes.map((l) => l.agentId).sort()).toEqual(['a', 'b']);
  });

  it('derives the project label from the last path segment of the repo path', () => {
    const lanes = buildLanes(baseInput({ agents: [agent('a', { repoPath: '/work/acme-app' })] }));
    expect(lanes[0].projectLabel).toBe('acme-app');
  });

  it('falls back to Unknown when there is no repo path', () => {
    const lanes = buildLanes(baseInput({ agents: [agent('a')] }));
    expect(lanes[0].projectLabel).toBe('Unknown');
  });

  it('derives the monogram from the agent name', () => {
    const lanes = buildLanes(baseInput({ agents: [agent('a', { name: 'Wiki lint' })] }));
    expect(lanes[0].monogram).toBe('WL');
  });

  it('marks a lane muted when its agent is in the muted list', () => {
    const lanes = buildLanes(baseInput({ agents: [agent('a')], mutedAgentIds: ['a'] }));
    expect(lanes[0].muted).toBe(true);
  });

  it('leaves the unread count unchanged by muting — mute only hides rows, never counts', () => {
    const withEvents = baseInput({
      agents: [agent('a')],
      agentEvents: {
        a: [
          { kind: 'run', label: 'r', at: 1 },
          { kind: 'run', label: 'r', at: 2 },
        ],
      },
      laneSeenAt: { a: 0 },
    });
    const unmuted = buildLanes(withEvents);
    const muted = buildLanes({ ...withEvents, mutedAgentIds: ['a'] });
    expect(muted[0].unread).toBe(unmuted[0].unread);
  });

  it('marks a lane running only when the agent status is running', () => {
    const lanes = buildLanes(
      baseInput({ agents: [agent('a', { status: 'running' }), agent('b', { status: 'idle' })] })
    );
    expect(lanes.find((l) => l.agentId === 'a')?.running).toBe(true);
    expect(lanes.find((l) => l.agentId === 'b')?.running).toBe(false);
  });

  it('flags a lane with a question when the agent is awaiting input', () => {
    const lanes = buildLanes(
      baseInput({ agents: [agent('a', { status: 'running', awaitingInput: true })] })
    );
    expect(lanes[0].hasQuestion).toBe(true);
    expect(lanes[0].state).toBe('yours');
  });

  it("counts unread from the agent's own event list against its seen mark", () => {
    const lanes = buildLanes(
      baseInput({
        agents: [agent('a')],
        agentEvents: {
          a: [
            { kind: 'run', label: 'r', at: 1 },
            { kind: 'run', label: 'r', at: 5 },
          ],
        },
        laneSeenAt: { a: 2 },
      })
    );
    expect(lanes[0].unread).toBe(1);
  });

  it('orders lanes needing attention before working and done ones', () => {
    const lanes = buildLanes(
      baseInput({
        agents: [
          agent('done', { status: 'idle' }),
          agent('yours', { status: 'running', awaitingInput: true }),
          agent('working', { status: 'running' }),
        ],
      })
    );
    expect(lanes.map((l) => l.agentId)).toEqual(['yours', 'working', 'done']);
  });

  it('orders lanes of the same state by name', () => {
    const lanes = buildLanes(
      baseInput({
        agents: [
          agent('z', { name: 'Zebra', status: 'running' }),
          agent('a', { name: 'Apple', status: 'running' }),
        ],
      })
    );
    expect(lanes.map((l) => l.agentId)).toEqual(['a', 'z']);
  });
});
