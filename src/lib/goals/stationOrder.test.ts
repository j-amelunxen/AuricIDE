import { describe, expect, it } from 'vitest';
import type { PmGoalStation } from '../tauri/goals';
import {
  insertHumanStation,
  moveStation,
  normalizeSortOrders,
  orderedStations,
} from './stationOrder';

const TS = '2026-01-10 10:00:00';
let seq = 0;

function makeStation(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: `s-${++seq}`,
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
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function chain(...stations: Partial<PmGoalStation>[]): PmGoalStation[] {
  return stations.map((s, i) => makeStation({ sortOrder: i, ...s }));
}

describe('orderedStations', () => {
  it('returns only the goal stations sorted by sortOrder', () => {
    const mine = chain({ name: 'a' }, { name: 'b' });
    const other = makeStation({ goalId: 'g2', name: 'foreign' });
    const shuffled = [mine[1], other, mine[0]];
    expect(orderedStations(shuffled, 'g1').map((s) => s.name)).toEqual(['a', 'b']);
  });
});

describe('moveStation', () => {
  it('moves a station to the requested index', () => {
    const stations = chain({ name: 'a' }, { name: 'b' }, { name: 'c' });
    const moved = moveStation(stations, 'g1', stations[2].id, 0);
    expect(orderedStations(moved, 'g1').map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  it('never places a pending station before done work', () => {
    const stations = chain(
      { name: 'done-1', status: 'done' },
      { name: 'done-2', status: 'done' },
      { name: 'a' },
      { name: 'b' }
    );
    const moved = moveStation(stations, 'g1', stations[3].id, 0);
    // Clamped to right after the done segment, index 2 — history stays put.
    expect(orderedStations(moved, 'g1').map((s) => s.name)).toEqual(['done-1', 'done-2', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const stations = chain({ name: 'a' }, { name: 'b' });
    const before = stations.map((s) => s.sortOrder);
    moveStation(stations, 'g1', stations[1].id, 0);
    expect(stations.map((s) => s.sortOrder)).toEqual(before);
  });

  it('leaves stations of other goals untouched', () => {
    const mine = chain({ name: 'a' }, { name: 'b' });
    const other = makeStation({ goalId: 'g2', sortOrder: 99 });
    const moved = moveStation([...mine, other], 'g1', mine[1].id, 0);
    expect(moved.find((s) => s.goalId === 'g2')!.sortOrder).toBe(99);
  });

  it('is a no-op for an unknown station id', () => {
    const stations = chain({ name: 'a' });
    const moved = moveStation(stations, 'g1', 'missing', 0);
    expect(orderedStations(moved, 'g1').map((s) => s.name)).toEqual(['a']);
  });
});

describe('insertHumanStation', () => {
  it('appends at the end of the planned segment as a human step', () => {
    const stations = chain(
      { name: 'done-1', status: 'done' },
      { name: 'planned-1' },
      { name: 'foggy', status: 'fog' }
    );
    const next = insertHumanStation(stations, 'g1', 'Call the customer', 'h1', TS);
    const ordered = orderedStations(next, 'g1');
    expect(ordered.map((s) => s.name)).toEqual([
      'done-1',
      'planned-1',
      'Call the customer',
      'foggy',
    ]);
    const inserted = ordered[2];
    expect(inserted.kind).toBe('human');
    expect(inserted.evidenceKind).toBe('human');
    expect(inserted.predicate).toEqual({ type: 'human' });
    expect(inserted.status).toBe('planned');
  });

  it('starts an empty line with the human step alone', () => {
    const next = insertHumanStation([], 'g1', 'Send the email', 'h1', TS);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Send the email');
  });
});

describe('normalizeSortOrders', () => {
  it('renumbers the goal stations 0..n in current order', () => {
    const stations = [
      makeStation({ sortOrder: 10, name: 'a' }),
      makeStation({ sortOrder: 20, name: 'b' }),
    ];
    const normalized = normalizeSortOrders(stations, 'g1');
    expect(orderedStations(normalized, 'g1').map((s) => s.sortOrder)).toEqual([0, 1]);
  });
});
