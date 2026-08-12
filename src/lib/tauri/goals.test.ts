import { describe, expect, it } from 'vitest';
import { parseStationRow, type PmGoalStationWire } from './goals';

function wire(overrides: Partial<PmGoalStationWire> = {}): PmGoalStationWire {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Step',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: '{"type":"undefined"}',
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('parseStationRow', () => {
  it('parses a valid stored predicate into the domain shape', () => {
    const station = parseStationRow(
      wire({ predicate: '{"type":"file_exists","glob":"src/lib/**/*.ts"}' })
    );
    expect(station.predicate).toEqual({ type: 'file_exists', glob: 'src/lib/**/*.ts' });
  });

  it('degrades incomplete predicates so they cannot launder into machine proof', () => {
    expect(parseStationRow(wire({ predicate: '{"type":"file_exists"}' })).predicate).toEqual({
      type: 'undefined',
    });
    expect(parseStationRow(wire({ predicate: '{"type":"git_touches"}' })).predicate).toEqual({
      type: 'undefined',
    });
    expect(parseStationRow(wire({ predicate: '{"type":"ticket_done"}' })).predicate).toEqual({
      type: 'undefined',
    });
  });

  it('degrades tautological globs and corrupt JSON', () => {
    expect(parseStationRow(wire({ predicate: '{"type":"file_exists","glob":"**"}' })).predicate).toEqual(
      { type: 'undefined' }
    );
    expect(parseStationRow(wire({ predicate: 'not-json' })).predicate).toEqual({ type: 'undefined' });
  });
});
