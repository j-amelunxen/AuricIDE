import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPlannerOps } from './applyPlannerOps';
import { extractJson, parsePlannerGraph, parsePlannerOps } from './plannerSchema';
import { planToStations } from './commitPlan';
import { deletePlannerDraft, loadPlannerDraft, savePlannerDraft } from './plannerDraft';

const mockDbGet = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const mockDbSet = vi.fn(async () => {});
const mockDbDelete = vi.fn(async () => true);

vi.mock('@/lib/tauri/db', () => ({
  dbGet: (...a: unknown[]) => mockDbGet(...a),
  dbSet: (...a: unknown[]) => mockDbSet(...a),
  dbDelete: (...a: unknown[]) => mockDbDelete(...a),
}));

const GRAPH_JSON = JSON.stringify({
  stations: [
    {
      name: 'Take inventory',
      kind: 'normal',
      evidenceKind: 'claim',
      predicate: { type: 'undefined' },
    },
    { name: 'Call the client', kind: 'human', evidenceKind: 'human', predicate: { type: 'human' } },
    {
      name: 'Getting started guide',
      kind: 'normal',
      evidenceKind: 'claim',
      predicate: { type: 'undefined' },
      fog: true,
    },
  ],
});

describe('plannerSchema', () => {
  it('parses a valid graph, including fenced JSON with prose around it', () => {
    const graph = parsePlannerGraph('Here you go:\n```json\n' + GRAPH_JSON + '\n```\nDone.');
    expect(graph.stations).toHaveLength(3);
    expect(graph.stations[1].kind).toBe('human');
    expect(graph.stations[2].fog).toBe(true);
  });

  it('rejects malformed JSON with the parse error surfaced', () => {
    expect(() => parsePlannerGraph('{ "stations": [ { name: nope ] }')).toThrow(/JSON/);
  });

  it('names the field and the received value on a bad enum', () => {
    const bad = JSON.stringify({
      stations: [
        { name: 'X', kind: 'milestone', evidenceKind: 'claim', predicate: { type: 'undefined' } },
      ],
    });
    expect(() => parsePlannerGraph(bad)).toThrow(/stations\[0\]\.kind.*milestone/);
  });

  it('rejects an empty plan', () => {
    expect(() => parsePlannerGraph('{ "stations": [] }')).toThrow(/must not be empty/);
  });

  it('requires predicate params per type', () => {
    const bad = JSON.stringify({
      stations: [
        { name: 'X', kind: 'normal', evidenceKind: 'proof', predicate: { type: 'file_exists' } },
      ],
    });
    expect(() => parsePlannerGraph(bad)).toThrow(/file_exists requires a glob/);
  });

  it('parses ops and rejects unknown op names', () => {
    const ops = parsePlannerOps('{ "ops": [ { "op": "remove", "index": 1 } ] }');
    expect(ops).toEqual([{ op: 'remove', index: 1 }]);
    expect(() => parsePlannerOps('[ { "op": "explode", "index": 0 } ]')).toThrow(/explode/);
  });

  it('extractJson refuses responses without JSON', () => {
    expect(() => extractJson('I would rather chat about the weather.')).toThrow(/No JSON/);
  });
});

describe('applyPlannerOps', () => {
  const graph = parsePlannerGraph(GRAPH_JSON);

  it('applies a batch sequentially', () => {
    const next = applyPlannerOps(graph, [
      { op: 'rename', index: 0, name: 'Inventory' },
      { op: 'move', index: 2, toIndex: 1 },
      { op: 'add', station: graph.stations[1], afterIndex: 0 },
    ]);
    expect(next.stations.map((s) => s.name)).toEqual([
      'Inventory',
      'Call the client',
      'Getting started guide',
      'Call the client',
    ]);
    // input untouched
    expect(graph.stations[0].name).toBe('Take inventory');
  });

  it('rejects the whole batch on an out-of-range index', () => {
    expect(() =>
      applyPlannerOps(graph, [
        { op: 'rename', index: 0, name: 'Fine' },
        { op: 'remove', index: 99 },
      ])
    ).toThrow(/out of range/);
  });

  it('split keeps the base station shape for both halves', () => {
    const next = applyPlannerOps(graph, [{ op: 'split', index: 0, into: ['Read', 'Sort'] }]);
    expect(next.stations.map((s) => s.name).slice(0, 2)).toEqual(['Read', 'Sort']);
    expect(next.stations[0].evidenceKind).toBe(next.stations[1].evidenceKind);
  });

  it('refuses to empty the plan', () => {
    const one = parsePlannerGraph(
      JSON.stringify({
        stations: [
          { name: 'Only', kind: 'normal', evidenceKind: 'claim', predicate: { type: 'undefined' } },
        ],
      })
    );
    expect(() => applyPlannerOps(one, [{ op: 'remove', index: 0 }])).toThrow(/empty/);
  });
});

describe('planToStations', () => {
  it('commits everything as planned/fog with sequential sortOrder', () => {
    let n = 0;
    const rows = planToStations(parsePlannerGraph(GRAPH_JSON), 'g1', () => `id-${++n}`, 'TS');
    expect(rows.map((r) => r.status)).toEqual(['planned', 'planned', 'fog']);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    expect(rows[1].kind).toBe('human');
    expect(rows.every((r) => r.goalId === 'g1')).toBe(true);
  });
});

describe('plannerDraft persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a draft through the kv store', async () => {
    const draft = { graph: parsePlannerGraph(GRAPH_JSON), revisions: [] };
    await savePlannerDraft('/p', 'g1', draft);
    expect(mockDbSet).toHaveBeenCalledWith('/p', 'goal_line_planner', 'g1', JSON.stringify(draft));

    mockDbGet.mockResolvedValueOnce(JSON.stringify(draft));
    const loaded = await loadPlannerDraft('/p', 'g1');
    expect(loaded?.graph.stations).toHaveLength(3);
  });

  it('discards a corrupt draft instead of crashing', async () => {
    mockDbGet.mockResolvedValueOnce('not json at all {');
    expect(await loadPlannerDraft('/p', 'g1')).toBeNull();
  });

  it('deletes through the same namespace', async () => {
    await deletePlannerDraft('/p', 'g1');
    expect(mockDbDelete).toHaveBeenCalledWith('/p', 'goal_line_planner', 'g1');
  });
});
