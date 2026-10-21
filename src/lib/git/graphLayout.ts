import { GRAPH_COLOR_COUNT } from './graphColors';

/** What the layout needs of a commit; `GraphCommit` satisfies it. */
export interface LayoutCommit {
  oid: string;
  parents: string[];
}

export interface GraphEdge {
  fromLane: number;
  toLane: number;
  color: number;
  part: 'top' | 'bottom';
}

export interface GraphRow {
  oid: string;
  /** Column of the commit dot. */
  lane: number;
  /** Palette index of the commit's lane. */
  color: number;
  /** Segments touching this row, sorted top half first, then by lane. */
  edges: GraphEdge[];
  isMerge: boolean;
  /** Highest lane touched by the dot or any edge, plus one. */
  width: number;
}

interface Lane {
  /** The commit this lane is waiting for. */
  oid: string;
  color: number;
  /**
   * Reserved for HEAD before HEAD has been seen: the lane keeps lane 0 free
   * for HEAD's line but draws nothing, since nothing above HEAD leads to it.
   */
  phantom?: boolean;
}

type Lanes = Array<Lane | null>;

/** Lane state between two pages. Opaque to callers; pass it back unchanged. */
export interface LayoutCarry {
  lanes: Lanes;
  nextColor: number;
}

function firstFreeLane(lanes: Lanes): number {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
}

function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  const rank = (e: GraphEdge) => (e.part === 'top' ? 0 : 1);
  return edges.sort((a, b) => rank(a) - rank(b) || a.fromLane - b.fromLane || a.toLane - b.toLane);
}

function seed(headOid: string | null): LayoutCarry {
  const lanes: Lanes = headOid ? [{ oid: headOid, color: 0, phantom: true }] : [];
  return { lanes, nextColor: 1 };
}

/**
 * Lays commits (newest first, parents after children) out on lanes, the way
 * `git log --graph` does. Feeding the next page with the previous `carry`
 * yields exactly the rows one call over both pages would.
 */
export function layoutGraph(
  commits: LayoutCommit[],
  headOid: string | null,
  carry?: LayoutCarry
): { rows: GraphRow[]; carry: LayoutCarry } {
  const start = carry ?? seed(headOid);
  let lanes: Lanes = start.lanes.map((l) => (l ? { ...l } : null));
  let nextColor = start.nextColor;

  /** Colour 0 is HEAD's line (the seed); every other new line cycles through 1..COUNT-1. */
  const newColor = (): number => 1 + ((nextColor++ - 1) % (GRAPH_COLOR_COUNT - 1));

  const rows = commits.map((commit): GraphRow => {
    const edges: GraphEdge[] = [];
    const waiting = lanes.flatMap((l, i) => (l?.oid === commit.oid ? [i] : []));

    let lane: number;
    let color: number;
    if (waiting.length > 0) {
      lane = waiting[0];
      color = lanes[lane]!.color;
    } else {
      lane = firstFreeLane(lanes);
      color = newColor();
    }

    lanes.forEach((l, i) => {
      if (!l || l.phantom) return;
      const target = waiting.includes(i) ? lane : i;
      edges.push({ fromLane: i, toLane: target, color: l.color, part: 'top' });
    });

    for (const i of waiting) lanes[i] = null;
    lanes[lane] = null;

    lanes.forEach((l, i) => {
      if (l && !l.phantom) edges.push({ fromLane: i, toLane: i, color: l.color, part: 'bottom' });
    });

    commit.parents.forEach((parent, index) => {
      const existing = index === 0 ? -1 : lanes.findIndex((l) => l?.oid === parent);
      if (existing !== -1) {
        // A parent landing in HEAD's reserved lane is HEAD itself: the line is real from here on.
        if (lanes[existing]!.phantom)
          lanes[existing] = { oid: parent, color: lanes[existing]!.color };
        edges.push({
          fromLane: lane,
          toLane: existing,
          color: lanes[existing]!.color,
          part: 'bottom',
        });
        return;
      }
      const target = index === 0 ? lane : firstFreeLane(lanes);
      const parentColor = index === 0 ? color : newColor();
      lanes[target] = { oid: parent, color: parentColor };
      edges.push({ fromLane: lane, toLane: target, color: parentColor, part: 'bottom' });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(lane, ...edges.flatMap((e) => [e.fromLane, e.toLane])) + 1;
    return {
      oid: commit.oid,
      lane,
      color,
      edges: sortEdges(edges),
      isMerge: commit.parents.length > 1,
      width,
    };
  });

  lanes = lanes.map((l) => (l ? { ...l } : null));
  return { rows, carry: { lanes, nextColor } };
}

/** The tip and every ancestor of it among the loaded commits (parents not loaded are included by oid). */
export function reachableFrom(commits: LayoutCommit[], tipOid: string): Set<string> {
  const parentsOf = new Map(commits.map((c) => [c.oid, c.parents]));
  const reached = new Set<string>();
  const pending = [tipOid];
  for (let oid = pending.pop(); oid !== undefined; oid = pending.pop()) {
    if (reached.has(oid)) continue;
    reached.add(oid);
    pending.push(...(parentsOf.get(oid) ?? []));
  }
  return reached;
}

/**
 * For "go to the child" navigation: each commit maps to one child. A child
 * whose first parent it is wins over a merge that has it second; among equals
 * the nearest row above wins.
 */
export function firstChildOf(commits: LayoutCommit[]): Map<string, string> {
  const children = new Map<string, { oid: string; isFirstParent: boolean }>();
  for (const commit of commits) {
    commit.parents.forEach((parent, index) => {
      const isFirstParent = index === 0;
      const current = children.get(parent);
      if (current?.isFirstParent && !isFirstParent) return;
      children.set(parent, { oid: commit.oid, isFirstParent });
    });
  }
  return new Map([...children].map(([parent, child]) => [parent, child.oid]));
}
