/**
 * The agent terminal can show up to four agents at once. The area is a 2×2
 * grid of quadrants, and each quadrant names the agent drawn in it — a half
 * is one agent in two neighbouring quadrants, a single terminal is one agent
 * in all four. Every quadrant always holds an agent, so there is never an
 * empty hole, and one agent's quadrants always form a rectangle.
 *
 * Order: top-left, top-right, bottom-left, bottom-right.
 */
export type GridCells = readonly [string, string, string, string];

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br' | 'center';

const ZONE_CELLS: Record<DropZone, readonly number[]> = {
  left: [0, 2],
  right: [1, 3],
  top: [0, 1],
  bottom: [2, 3],
  tl: [0],
  tr: [1],
  bl: [2],
  br: [3],
  center: [0, 1, 2, 3],
};

export const DROP_ZONES = Object.keys(ZONE_CELLS) as DropZone[];

/** How far in from an edge still counts as that edge, as a share of the area. */
const EDGE_ZONE_SHARE = 0.28;

type Draft = (string | null)[];

export function singleGrid(agentId: string): GridCells {
  return [agentId, agentId, agentId, agentId];
}

export function isSplit(cells: GridCells): boolean {
  return cells.some((id) => id !== cells[0]);
}

function cellsOf(draft: Draft, agentId: string): number[] {
  return draft.flatMap((id, index) => (id === agentId ? [index] : []));
}

/** One, two neighbouring or all four quadrants. Three is an L, a diagonal is two islands. */
function isRectangle(indices: number[]): boolean {
  if (indices.length === 2) return (indices[0] ^ indices[1]) !== 3;
  return indices.length !== 3;
}

function isValid(draft: Draft): boolean {
  const ids = new Set(draft.filter((id): id is string => id !== null));
  return [...ids].every((id) => isRectangle(cellsOf(draft, id)));
}

/**
 * An agent left with three quadrants keeps the column the newcomer is not in:
 * side by side is the layout people ask for, so a corner drop on a single
 * terminal becomes two halves rather than a quarter beside an L.
 */
function shrinkToRectangles(draft: Draft): Draft {
  const next = [...draft];
  for (const id of new Set(draft)) {
    if (id === null) continue;
    const own = cellsOf(next, id);
    if (own.length !== 3) continue;
    const taken = [0, 1, 2, 3].find((index) => !own.includes(index)) ?? 0;
    next[taken ^ 2] = null;
  }
  return next;
}

/**
 * Hands every free quadrant to a neighbour — the one above or below first,
 * then the one beside it — preferring a choice that keeps all panes
 * rectangular. Null when there is no agent left to grow.
 */
function fill(draft: Draft): GridCells | null {
  const next = [...draft];
  if (next.every((id) => id === null)) return null;
  while (next.includes(null)) {
    for (let index = 0; index < 4; index++) {
      if (next[index] !== null) continue;
      const candidates = [next[index ^ 2], next[index ^ 1], next[index ^ 3]].filter(
        (id): id is string => id !== null
      );
      if (candidates.length === 0) continue;
      const fits = candidates.find((id) => {
        const trial = [...next];
        trial[index] = id;
        return isValid(trial);
      });
      next[index] = fits ?? candidates[0];
    }
  }
  return next as unknown as GridCells;
}

/**
 * Puts an agent on a zone. An agent already shown moves there.
 *
 * When the agent was alone on screen, the quadrants it leaves have no
 * neighbour to grow into — the grid would collapse back to one terminal and
 * the drop would look like it did nothing. The first of `spareIds` takes them
 * instead, so a lone terminal can be sent to a half or a corner.
 */
export function placeAgent(
  cells: GridCells,
  agentId: string,
  zone: DropZone,
  spareIds: readonly string[] = []
): GridCells {
  let draft: Draft = cells.map((id) => (id === agentId ? null : id));
  for (const index of ZONE_CELLS[zone]) draft[index] = agentId;
  draft = shrinkToRectangles(draft);
  const spare = spareIds.find((id) => id !== agentId);
  if (spare && !draft.some((id) => id !== null && id !== agentId)) {
    draft = shrinkToRectangles(draft.map((id) => id ?? spare));
  }
  return fill(draft) ?? singleGrid(agentId);
}

/**
 * Where a newly arrived agent goes when nobody arranged it: the second beside
 * the first, then the third and fourth into the corners. Once all four
 * quadrants hold their own agent the grid stays as it is — the rest are tabs.
 *
 * It reads the layout rather than counting slots, so a user's own arrangement
 * is respected: the agent holding two quadrants (the later one, if both do)
 * gives up its last one.
 */
export function autoPlace(cells: GridCells, arrivedId: string): GridCells {
  if (cells.includes(arrivedId)) return cells;
  const shown = [...new Set(cells)];
  if (shown.length === 1) return placeAgent(cells, arrivedId, 'right');
  if (shown.length >= 4) return cells;
  const lastQuadrant = Math.max(
    ...shown
      .map((id) => cellsOf([...cells], id))
      .filter((own) => own.length === 2)
      .flat()
  );
  return cells.map((id, index) =>
    index === lastQuadrant ? arrivedId : id
  ) as unknown as GridCells;
}

/** Takes an agent out; its neighbours grow into the space. Null when it was the last one. */
export function removeAgent(cells: GridCells, agentId: string): GridCells | null {
  if (!cells.includes(agentId)) return cells;
  return fill(cells.map((id) => (id === agentId ? null : id)));
}

/**
 * Makes sure an agent is on screen: one that already is stays put, any other
 * takes the pane of `focusedId` — or the first pane when that one is not shown.
 */
export function showAgent(cells: GridCells, focusedId: string, agentId: string): GridCells {
  if (cells.includes(agentId)) return cells;
  const replaced = cells.includes(focusedId) ? focusedId : cells[0];
  return cells.map((id) => (id === replaced ? agentId : id)) as unknown as GridCells;
}

/**
 * A stored grid read against the fleet as it is now: agents that are gone give
 * their space up, and the active agent is always on screen.
 */
export function reconcileGrid(
  stored: GridCells | null,
  liveAgentIds: readonly string[],
  activeId: string
): GridCells {
  if (!stored) return singleGrid(activeId);
  const live = new Set(liveAgentIds);
  live.add(activeId);
  const kept = fill(stored.map((id) => (live.has(id) ? id : null)));
  if (!kept) return singleGrid(activeId);
  return showAgent(kept, kept[0], activeId);
}

interface GridPane {
  agentId: string;
  /** 1-based, as CSS grid lines count. */
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/** One pane per agent, in reading order of where each first appears. */
export function paneLayout(cells: GridCells): GridPane[] {
  return [...new Set(cells)].map((agentId) => {
    const own = cellsOf([...cells], agentId);
    const rows = own.map((index) => index >> 1);
    const cols = own.map((index) => index & 1);
    const row = Math.min(...rows);
    const col = Math.min(...cols);
    return {
      agentId,
      row: row + 1,
      col: col + 1,
      rowSpan: Math.max(...rows) - row + 1,
      colSpan: Math.max(...cols) - col + 1,
    };
  });
}

interface AreaRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The zone under a pointer, or null when it is outside the terminal area. */
export function zoneAt(clientX: number, clientY: number, rect: AreaRect): DropZone | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const horizontal = x < EDGE_ZONE_SHARE ? 'l' : x > 1 - EDGE_ZONE_SHARE ? 'r' : null;
  const vertical = y < EDGE_ZONE_SHARE ? 't' : y > 1 - EDGE_ZONE_SHARE ? 'b' : null;
  if (horizontal && vertical) return `${vertical}${horizontal}` as DropZone;
  if (horizontal) return horizontal === 'l' ? 'left' : 'right';
  if (vertical) return vertical === 't' ? 'top' : 'bottom';
  return 'center';
}

/** The share of the area a drop on this zone would take, for the drop preview. */
export function zoneRect(zone: DropZone): AreaRect {
  const own = ZONE_CELLS[zone];
  const rows = own.map((index) => index >> 1);
  const cols = own.map((index) => index & 1);
  const top = Math.min(...rows) / 2;
  const left = Math.min(...cols) / 2;
  return {
    left,
    top,
    width: (Math.max(...cols) + 1) / 2 - left,
    height: (Math.max(...rows) + 1) / 2 - top,
  };
}
