import { describe, expect, it } from 'vitest';
import { feedRowKey, type FeedRow } from './events/feed';
import type { FeedGroup } from './lanes';
import { FEED_RENDER_LIMIT, FEED_REVEAL_STEP, trimGroupsToWindow } from './feedWindow';

function row(seq: number, at = 0): FeedRow {
  return { agentId: 'a1', agentName: 'A1', kind: 'edit', label: `row ${seq}`, at, seq };
}

function group(agentId: string, rows: FeedRow[]): FeedGroup {
  return { agentId, agentName: agentId, at: rows[0].at, rows };
}

describe('feedWindow constants', () => {
  it('renders 300 rows at a time and reveals 300 more per click', () => {
    expect(FEED_RENDER_LIMIT).toBe(300);
    expect(FEED_REVEAL_STEP).toBe(300);
  });
});

describe('trimGroupsToWindow', () => {
  it('returns every group untouched when the window covers all rows', () => {
    const groups = [group('a1', [row(0), row(1)]), group('a2', [row(0), row(1)])];
    const result = trimGroupsToWindow(groups, 10);
    expect(result).toHaveLength(2);
    expect(result[0].group).toBe(groups[0]);
    expect(result[1].group).toBe(groups[1]);
  });

  it('drops whole groups from the oldest end once they fall outside the window', () => {
    const oldest = group('a1', [row(0), row(1)]);
    const newest = group('a2', [row(0), row(1)]);
    const result = trimGroupsToWindow([oldest, newest], 2);
    expect(result).toHaveLength(1);
    expect(result[0].group).toBe(newest);
  });

  it('splits the one group straddling the window boundary, keeping its newest rows', () => {
    const straddling = group('a1', [row(0), row(1), row(2)]);
    const newest = group('a2', [row(0)]);
    const result = trimGroupsToWindow([straddling, newest], 2);

    expect(result).toHaveLength(2);
    expect(result[0].group.rows.map((r) => r.label)).toEqual(['row 2']);
    expect(result[1].group).toBe(newest);
  });

  it('keys a split group by its original first row, not the slice — so it keeps its identity', () => {
    const straddling = group('a1', [row(0), row(1), row(2)]);
    const result = trimGroupsToWindow([straddling], 1);
    expect(result[0].key).toBe(feedRowKey(straddling.rows[0]));
  });

  it('keys an untouched group by its own first row', () => {
    const groups = [group('a1', [row(0), row(1)])];
    const result = trimGroupsToWindow(groups, 10);
    expect(result[0].key).toBe(feedRowKey(groups[0].rows[0]));
  });
});
