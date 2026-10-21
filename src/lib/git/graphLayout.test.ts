import { describe, expect, it } from 'vitest';
import fixtures from './gitGraph.fixtures.json';
import { GRAPH_COLOR_COUNT } from './graphColors';
import {
  firstChildOf,
  layoutGraph,
  reachableFrom,
  type GraphRow,
  type LayoutCommit,
} from './graphLayout';

interface Fixture {
  name: string;
  headOid: string | null;
  commits: LayoutCommit[];
  rows: Array<{ oid: string; lane: number; color: number; width: number; edges?: string[] }>;
}

const FIXTURES = fixtures as Fixture[];

function summary(rows: GraphRow[]) {
  return rows.map(({ oid, lane, color, width }) => ({ oid, lane, color, width }));
}

const edgeLabels = (row: GraphRow) =>
  row.edges.map((e) => `${e.part}:${e.fromLane}>${e.toLane}@${e.color}`);

/** Lanes leaving row i at the bottom must enter row i+1 at the top, and nothing enters from nowhere. */
function continuityGaps(rows: GraphRow[]): string[] {
  const gaps: string[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const down = new Set(rows[i].edges.filter((e) => e.part === 'bottom').map((e) => e.toLane));
    const up = new Set(rows[i + 1].edges.filter((e) => e.part === 'top').map((e) => e.fromLane));
    for (const lane of down)
      if (!up.has(lane)) gaps.push(`${rows[i].oid}->${rows[i + 1].oid}: lane ${lane} ends`);
    for (const lane of up)
      if (!down.has(lane)) gaps.push(`${rows[i + 1].oid}: lane ${lane} from nowhere`);
  }
  return gaps;
}

/** Seeded generator, so a failing DAG can be replayed. */
function seededRandom(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function randomDag(seed: number): { commits: LayoutCommit[]; head: string } {
  const random = seededRandom(seed);
  const count = 4 + Math.floor(random() * 12);
  const commits: LayoutCommit[] = [];
  for (let i = 0; i < count; i++) {
    const parents: string[] = [];
    if (i < count - 1) {
      parents.push(`c${i + 1 + Math.floor(random() * Math.min(3, count - 1 - i))}`);
      if (random() < 0.3 && i < count - 2) {
        const second = `c${i + 1 + Math.floor(random() * (count - 1 - i))}`;
        if (!parents.includes(second)) parents.push(second);
      }
    }
    commits.push({ oid: `c${i}`, parents });
  }
  return { commits, head: `c${Math.floor(random() * count)}` };
}

function edgesOf(rows: GraphRow[], oid: string): string[] {
  const row = rows.find((r) => r.oid === oid);
  if (!row) throw new Error(`no row ${oid}`);
  return row.edges.map((e) => `${e.part}:${e.fromLane}>${e.toLane}@${e.color}`);
}

const fixture = (name: string) => FIXTURES.find((f) => f.name === name)!;
const layoutOf = (name: string) => layoutGraph(fixture(name).commits, fixture(name).headOid).rows;

describe('layoutGraph fixtures', () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))('%s: lane, colour and width', (_n, f) => {
    const rows = layoutGraph(f.commits, f.headOid).rows;
    expect(summary(rows)).toEqual(f.rows.map(({ edges: _e, ...rest }) => rest));
    f.rows.forEach((expected, i) => {
      if (expected.edges) expect(edgeLabels(rows[i])).toEqual(expected.edges);
    });
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    '%s: every line drawn down arrives',
    (_n, f) => {
      expect(continuityGaps(layoutGraph(f.commits, f.headOid).rows)).toEqual([]);
    }
  );

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    '%s: two pages laid out one after the other equal one call, at every split',
    (_n, f) => {
      const whole = layoutGraph(f.commits, f.headOid);
      for (let split = 0; split <= f.commits.length; split++) {
        const first = layoutGraph(f.commits.slice(0, split), f.headOid);
        const second = layoutGraph(f.commits.slice(split), f.headOid, first.carry);
        expect({ split, rows: [...first.rows, ...second.rows] }).toEqual({
          split,
          rows: whole.rows,
        });
        expect(second.carry).toEqual(whole.carry);
      }
    }
  );

  it('does not mutate the carry it was given', () => {
    const f = fixture('merge');
    const first = layoutGraph(f.commits.slice(0, 2), f.headOid);
    const snapshot = JSON.stringify(first.carry);
    layoutGraph(f.commits.slice(2), f.headOid, first.carry);
    expect(JSON.stringify(first.carry)).toBe(snapshot);
  });
});

describe('layoutGraph fuzz', () => {
  it('keeps every line continuous on 2000 seeded random DAGs, with and without a head', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const { commits, head } = randomDag(seed);
      for (const headOid of [head, null]) {
        expect({ seed, headOid, gaps: continuityGaps(layoutGraph(commits, headOid).rows) }).toEqual(
          {
            seed,
            headOid,
            gaps: [],
          }
        );
      }
    }
  });
});

describe('layoutGraph edges', () => {
  it('draws a fork: the second tip starts below, both lines meet in the top half of b', () => {
    const rows = layoutOf('fork');
    expect(edgesOf(rows, 'a')).toEqual(['bottom:0>0@0']);
    expect(edgesOf(rows, 'f')).toEqual(['top:0>0@0', 'bottom:0>0@0', 'bottom:1>1@1']);
    expect(edgesOf(rows, 'b')).toEqual(['top:0>0@0', 'top:1>0@1']);
  });

  it('draws a merge: the second parent leaves as a curve in the bottom half', () => {
    const rows = layoutOf('merge');
    expect(edgesOf(rows, 'm')).toEqual(['bottom:0>0@0', 'bottom:0>1@1']);
    expect(edgesOf(rows, 'a')).toEqual(['top:0>0@0', 'top:1>1@1', 'bottom:0>0@0', 'bottom:1>1@1']);
    expect(edgesOf(rows, 'b')).toEqual(['top:0>0@0', 'top:1>0@1']);
    expect(rows.map((r) => r.isMerge)).toEqual([true, false, false, false]);
  });

  it('points a merge at the lane that already waits for its second parent', () => {
    const rows = layoutOf('criss-cross');
    expect(edgesOf(rows, 'm1')).toEqual([
      'top:1>1@1',
      'top:2>2@2',
      'bottom:0>0@0',
      'bottom:0>1@1',
      'bottom:1>1@1',
      'bottom:2>2@2',
    ]);
  });

  it('draws no line above HEAD while HEAD has not shown up yet', () => {
    const rows = layoutOf('head-not-newest');
    expect(edgesOf(rows, 'n')).toEqual(['bottom:1>1@1']);
    expect(edgesOf(rows, 'h2')).toEqual(['top:1>1@1', 'bottom:0>0@0', 'bottom:1>1@1']);
  });
});

describe('layoutGraph special cases', () => {
  it('returns nothing for an unborn repository', () => {
    const result = layoutGraph([], null);
    expect(result.rows).toEqual([]);
    expect(layoutGraph([], null, result.carry).rows).toEqual([]);
  });

  it('without a head, the first line takes lane 0 but not the HEAD colour', () => {
    const rows = layoutGraph(
      [
        { oid: 'x', parents: ['y'] },
        { oid: 'y', parents: [] },
      ],
      null
    ).rows;
    expect(summary(rows)).toEqual([
      { oid: 'x', lane: 0, color: 1, width: 1 },
      { oid: 'y', lane: 0, color: 1, width: 1 },
    ]);
  });

  it('keeps lane 0 for a HEAD that is not in the loaded pages', () => {
    const rows = layoutGraph([{ oid: 'x', parents: [] }], 'not-loaded').rows;
    expect(summary(rows)).toEqual([{ oid: 'x', lane: 1, color: 1, width: 2 }]);
  });

  it('wraps colours around the palette instead of running past it', () => {
    // every tip waits for the same base, so none frees a lane and each opens a new one
    const tips = Array.from({ length: GRAPH_COLOR_COUNT + 2 }, (_, i) => ({
      oid: `t${i}`,
      parents: ['base'],
    }));
    const rows = layoutGraph([{ oid: 'h', parents: ['base'] }, ...tips], 'h').rows;
    // colour 0 is HEAD's; the rest cycle through 1..COUNT-1
    tips.forEach((_, i) => expect(rows[i + 1].color).toBe(1 + (i % (GRAPH_COLOR_COUNT - 1))));
  });
});

describe('reachableFrom', () => {
  const commits: LayoutCommit[] = [
    { oid: 'h', parents: ['m'] },
    { oid: 'x', parents: ['m'] },
    { oid: 'm', parents: ['b', 'q'] },
    { oid: 'b', parents: ['r'] },
    { oid: 'q', parents: ['r'] },
    { oid: 'r', parents: [] },
  ];

  it('collects the tip and every ancestor, through both parents of a merge', () => {
    expect([...reachableFrom(commits, 'x')].sort()).toEqual(['b', 'm', 'q', 'r', 'x']);
  });

  it('does not include siblings or descendants', () => {
    const set = reachableFrom(commits, 'b');
    expect(set.has('h')).toBe(false);
    expect(set.has('m')).toBe(false);
    expect([...set].sort()).toEqual(['b', 'r']);
  });

  it('stops at parents that are not loaded and tolerates an unknown tip', () => {
    expect([...reachableFrom([{ oid: 'a', parents: ['gone'] }], 'a')].sort()).toEqual([
      'a',
      'gone',
    ]);
    expect([...reachableFrom(commits, 'nope')]).toEqual(['nope']);
  });
});

describe('firstChildOf', () => {
  it('maps a commit to its child on the first-parent line, the nearest one above', () => {
    const commits: LayoutCommit[] = [
      { oid: 'h', parents: ['m'] },
      { oid: 'x', parents: ['m'] },
      { oid: 'm', parents: ['b'] },
      { oid: 'b', parents: [] },
    ];
    const children = firstChildOf(commits);
    expect(children.get('m')).toBe('x');
    expect(children.get('b')).toBe('m');
    expect(children.has('h')).toBe(false);
  });

  it('prefers a child that has the commit as first parent over a merge that has it second', () => {
    const commits: LayoutCommit[] = [
      { oid: 'l', parents: ['a'] },
      { oid: 'mg', parents: ['z', 'a'] },
      { oid: 'a', parents: [] },
    ];
    expect(firstChildOf(commits).get('a')).toBe('l');
  });

  it('falls back to a merge child when no child has it as first parent', () => {
    const commits: LayoutCommit[] = [
      { oid: 'mg', parents: ['z', 'a'] },
      { oid: 'a', parents: [] },
    ];
    expect(firstChildOf(commits).get('a')).toBe('mg');
  });
});
