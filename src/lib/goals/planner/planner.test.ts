import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPlannerOps } from './applyPlannerOps';
import {
  extractJson,
  parsePlannerGraph,
  parsePlannerOps,
  parseStoredPredicate,
  parseStoredPredicateJson,
} from './plannerSchema';
import { planToStations } from './commitPlan';
import { deletePlannerDraft, loadPlannerDraft, savePlannerDraft } from './plannerDraft';

const mockDbGet = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const mockDbSet = vi.fn(
  async (_projectPath: string, _namespace: string, _key: string, _value: string) => {}
);
const mockDbDelete = vi.fn(async (_projectPath: string, _namespace: string, _key: string) => true);

vi.mock('@/lib/tauri/db', () => ({
  dbGet: (projectPath: string, namespace: string, key: string) =>
    mockDbGet(projectPath, namespace, key),
  dbSet: (projectPath: string, namespace: string, key: string, value: string) =>
    mockDbSet(projectPath, namespace, key, value),
  dbDelete: (projectPath: string, namespace: string, key: string) =>
    mockDbDelete(projectPath, namespace, key),
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

  describe('parseStoredPredicate (read path)', () => {
    it('keeps a fully specified machine predicate', () => {
      expect(parseStoredPredicate({ type: 'file_exists', glob: 'docs/x.md' })).toEqual({
        type: 'file_exists',
        glob: 'docs/x.md',
      });
      expect(
        parseStoredPredicate({ type: 'git_touches', pathPrefix: 'src/', sinceIso: '2026-01-01' })
      ).toEqual({ type: 'git_touches', pathPrefix: 'src/', sinceIso: '2026-01-01' });
    });

    it('degrades incomplete predicates instead of casting them into the union', () => {
      expect(parseStoredPredicate({ type: 'file_exists' })).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate({ type: 'git_touches' })).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate({ type: 'ticket_done' })).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate({ type: 'requirement_verified' })).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate({ type: 'judged' })).toEqual({ type: 'undefined' });
    });

    it('degrades tautological file_exists globs that would match every path', () => {
      expect(parseStoredPredicate({ type: 'file_exists', glob: '**' })).toEqual({
        type: 'undefined',
      });
      expect(parseStoredPredicate({ type: 'file_exists', glob: '*/*' })).toEqual({
        type: 'undefined',
      });
    });

    it('degrades unknown types and non-objects', () => {
      expect(parseStoredPredicate({ type: 'telepathy' })).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate(null)).toEqual({ type: 'undefined' });
      expect(parseStoredPredicate('file_exists')).toEqual({ type: 'undefined' });
    });

    it('parses a stored JSON string and degrades corrupt JSON', () => {
      expect(parseStoredPredicateJson('{"type":"human"}')).toEqual({ type: 'human' });
      expect(parseStoredPredicateJson('{"type":"file_exists"}')).toEqual({ type: 'undefined' });
      expect(parseStoredPredicateJson('not json')).toEqual({ type: 'undefined' });
    });
  });

  it('repairs an evidenceKind that repeats its fully specified predicate type', () => {
    const graph = parsePlannerGraph(
      JSON.stringify({
        stations: [
          {
            name: 'Write the guide',
            kind: 'normal',
            evidenceKind: 'file_exists',
            predicate: { type: 'file_exists', glob: 'docs/guide.md' },
          },
        ],
      })
    );

    expect(graph.stations[0]).toMatchObject({
      evidenceKind: 'proof',
      predicate: { type: 'file_exists', glob: 'docs/guide.md' },
    });
  });

  it('maps a repeated undefined predicate type to claim evidence', () => {
    const graph = parsePlannerGraph(
      JSON.stringify({
        stations: [
          {
            name: 'Determine the check later',
            evidenceKind: 'undefined',
            predicate: { type: 'undefined' },
          },
        ],
      })
    );

    expect(graph.stations[0]).toMatchObject({
      evidenceKind: 'claim',
      predicate: { type: 'undefined' },
    });
  });

  it('repairs the same unambiguous field confusion in planner ops', () => {
    const ops = parsePlannerOps(
      JSON.stringify({
        ops: [
          {
            op: 'set_evidence',
            index: 0,
            evidenceKind: 'undefined',
            predicate: { type: 'undefined' },
          },
          {
            op: 'add',
            station: {
              name: 'Create changelog',
              evidenceKind: 'git_touches',
              predicate: { type: 'git_touches', pathPrefix: 'CHANGELOG.md' },
            },
          },
        ],
      })
    );

    expect(ops[0]).toMatchObject({ evidenceKind: 'claim', predicate: { type: 'undefined' } });
    expect(ops[1]).toMatchObject({
      station: { evidenceKind: 'proof', predicate: { type: 'git_touches' } },
    });
  });

  it('does not repair mismatched, incomplete, or arbitrary evidence kinds', () => {
    const station = (evidenceKind: string, predicate: object) =>
      JSON.stringify({ stations: [{ name: 'X', evidenceKind, predicate }] });

    expect(() =>
      parsePlannerGraph(station('file_exists', { type: 'git_touches', pathPrefix: 'src/' }))
    ).toThrow(/evidenceKind.*file_exists/);
    expect(() => parsePlannerGraph(station('file_exists', { type: 'file_exists' }))).toThrow(
      /file_exists requires a glob/
    );
    expect(() =>
      parsePlannerGraph(station('looks_good', { type: 'file_exists', glob: 'README.md' }))
    ).toThrow(/evidenceKind.*looks_good/);
  });

  it('parses ops and rejects unknown op names', () => {
    const ops = parsePlannerOps('{ "ops": [ { "op": "remove", "index": 1 } ] }');
    expect(ops).toEqual([{ op: 'remove', index: 1 }]);
    expect(() => parsePlannerOps('[ { "op": "explode", "index": 0 } ]')).toThrow(/explode/);
  });

  it('extractJson refuses responses without JSON', () => {
    expect(() => extractJson('I would rather chat about the weather.')).toThrow(/No JSON/);
  });

  it('logs the proposal phase, model response, and parse error before rethrowing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parsePlannerGraph('not json')).toThrow(/No JSON/);
    expect(error).toHaveBeenCalledWith(
      '[Planner] Failed to parse initial proposal',
      expect.objectContaining({ response: 'not json', error: expect.stringMatching(/No JSON/) })
    );

    error.mockClear();
    expect(() => parsePlannerOps('{"ops":[{"op":"nope"}]}')).toThrow(/nope/);
    expect(error).toHaveBeenCalledWith(
      '[Planner] Failed to parse refinement proposal',
      expect.objectContaining({
        response: '{"ops":[{"op":"nope"}]}',
        error: expect.stringMatching(/nope/),
      })
    );

    error.mockRestore();
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

  it('serializes saves so a slow older write cannot overwrite the latest draft', async () => {
    let releaseFirst!: () => void;
    mockDbSet
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValueOnce(undefined);
    const first = {
      graph: {
        stations: [
          {
            name: 'old',
            kind: 'normal' as const,
            evidenceKind: 'claim' as const,
            predicate: { type: 'undefined' as const },
          },
        ],
      },
      revisions: [],
    };
    const latest = {
      graph: { stations: [{ ...first.graph.stations[0], name: 'latest' }] },
      revisions: [],
    };
    const savingFirst = savePlannerDraft('/p', 'ordered', first);
    const savingLatest = savePlannerDraft('/p', 'ordered', latest);
    await vi.waitFor(() => expect(mockDbSet).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([savingFirst, savingLatest]);
    expect(JSON.parse(mockDbSet.mock.calls[1][3] as string).graph.stations[0].name).toBe('latest');
  });

  it('discards a corrupt draft instead of crashing', async () => {
    mockDbGet.mockResolvedValueOnce('not json at all {');
    expect(await loadPlannerDraft('/p', 'g1')).toBeNull();
  });

  it('deletes through the same namespace', async () => {
    await deletePlannerDraft('/p', 'g1');
    expect(mockDbDelete).toHaveBeenCalledWith('/p', 'goal_line_planner', 'g1');
  });

  it('waits for a pending save before deleting so the draft cannot be resurrected', async () => {
    let releaseSave!: () => void;
    mockDbSet.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        })
    );
    const draft = { graph: parsePlannerGraph(GRAPH_JSON), revisions: [] };
    const saving = savePlannerDraft('/p', 'delete-ordered', draft);
    await vi.waitFor(() => expect(mockDbSet).toHaveBeenCalledTimes(1));
    const deleting = deletePlannerDraft('/p', 'delete-ordered');
    await Promise.resolve();
    expect(mockDbDelete).not.toHaveBeenCalled();
    releaseSave();
    await Promise.all([saving, deleting]);
    expect(mockDbDelete).toHaveBeenCalledWith('/p', 'goal_line_planner', 'delete-ordered');
    expect(mockDbSet.mock.invocationCallOrder[0]).toBeLessThan(
      mockDbDelete.mock.invocationCallOrder[0]
    );
  });
});
