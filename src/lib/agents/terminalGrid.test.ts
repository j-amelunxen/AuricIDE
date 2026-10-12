import { describe, expect, it } from 'vitest';
import {
  DROP_ZONES,
  isSplit,
  paneLayout,
  placeAgent,
  reconcileGrid,
  removeAgent,
  showAgent,
  singleGrid,
  zoneAt,
  zoneRect,
  type DropZone,
  type GridCells,
} from './terminalGrid';

const RECT = { left: 100, top: 50, width: 1000, height: 600 };

describe('terminalGrid – placing a terminal', () => {
  it('starts as one terminal over the whole area', () => {
    expect(singleGrid('a')).toEqual(['a', 'a', 'a', 'a']);
    expect(isSplit(singleGrid('a'))).toBe(false);
  });

  it('a drop on a side puts the two terminals next to each other', () => {
    expect(placeAgent(singleGrid('a'), 'b', 'right')).toEqual(['a', 'b', 'a', 'b']);
    expect(placeAgent(singleGrid('a'), 'b', 'left')).toEqual(['b', 'a', 'b', 'a']);
  });

  it('a drop on top or bottom stacks them', () => {
    expect(placeAgent(singleGrid('a'), 'b', 'top')).toEqual(['b', 'b', 'a', 'a']);
    expect(placeAgent(singleGrid('a'), 'b', 'bottom')).toEqual(['a', 'a', 'b', 'b']);
  });

  it('a corner drop on a single terminal leaves no L-shaped pane behind', () => {
    // 'a' cannot keep three quadrants, so it keeps the far column and the
    // newcomer grows into the quadrant that was freed.
    expect(placeAgent(singleGrid('a'), 'b', 'tl')).toEqual(['b', 'a', 'b', 'a']);
  });

  it('corner drops build a grid of four', () => {
    let cells = placeAgent(singleGrid('a'), 'b', 'tl');
    cells = placeAgent(cells, 'c', 'bl');
    cells = placeAgent(cells, 'd', 'br');
    expect(cells).toEqual(['b', 'a', 'c', 'd']);
  });

  it('a corner drop next to a half only takes that quadrant', () => {
    expect(placeAgent(['a', 'b', 'a', 'b'], 'c', 'br')).toEqual(['a', 'b', 'a', 'c']);
  });

  it('moving a terminal that is already shown frees where it was', () => {
    expect(placeAgent(['b', 'a', 'b', 'a'], 'a', 'top')).toEqual(['a', 'a', 'b', 'b']);
    expect(placeAgent(['b', 'a', 'c', 'd'], 'd', 'left')).toEqual(['d', 'a', 'd', 'a']);
  });

  it('a drop on the middle goes back to one terminal', () => {
    expect(placeAgent(['b', 'a', 'c', 'd'], 'c', 'center')).toEqual(singleGrid('c'));
  });

  it('never produces a pane that is not a rectangle', () => {
    const agents = ['a', 'b', 'c', 'd', 'e'];
    const seen = new Set<string>();
    let frontier: GridCells[] = [singleGrid('a')];
    for (let depth = 0; depth < 4; depth++) {
      const next: GridCells[] = [];
      for (const cells of frontier) {
        for (const id of agents) {
          for (const zone of DROP_ZONES) {
            const result = placeAgent(cells, id, zone);
            const covered = paneLayout(result).reduce(
              (sum, pane) => sum + pane.rowSpan * pane.colSpan,
              0
            );
            expect(covered, `${cells.join()} + ${id}@${zone} -> ${result.join()}`).toBe(4);
            expect(result).toContain(id);
            const key = result.join();
            if (!seen.has(key)) {
              seen.add(key);
              next.push(result);
            }
          }
        }
      }
      frontier = next;
    }
  });
});

describe('terminalGrid – leaving the grid', () => {
  it('the neighbour takes over the space of a removed terminal', () => {
    expect(removeAgent(['a', 'b', 'a', 'b'], 'b')).toEqual(singleGrid('a'));
    expect(removeAgent(['b', 'a', 'c', 'd'], 'c')).toEqual(['b', 'a', 'b', 'd']);
    expect(removeAgent(['a', 'a', 'c', 'd'], 'a')).toEqual(['c', 'd', 'c', 'd']);
  });

  it('removing the last terminal leaves nothing', () => {
    expect(removeAgent(singleGrid('a'), 'a')).toBeNull();
  });

  it('removing a terminal that is not shown changes nothing', () => {
    const cells: GridCells = ['a', 'b', 'a', 'b'];
    expect(removeAgent(cells, 'x')).toBe(cells);
  });
});

describe('terminalGrid – choosing a tab', () => {
  it('a terminal that is already shown stays where it is', () => {
    const cells: GridCells = ['a', 'b', 'a', 'b'];
    expect(showAgent(cells, 'a', 'b')).toBe(cells);
  });

  it('a terminal that is not shown takes the place of the focused one', () => {
    expect(showAgent(['a', 'b', 'a', 'b'], 'b', 'c')).toEqual(['a', 'c', 'a', 'c']);
  });

  it('falls back to the first pane when the focused one is not in the grid', () => {
    expect(showAgent(['a', 'b', 'a', 'b'], 'x', 'c')).toEqual(['c', 'b', 'c', 'b']);
  });
});

describe('terminalGrid – reconciling a stored grid with the fleet', () => {
  it('no stored grid is the active terminal alone', () => {
    expect(reconcileGrid(null, ['a', 'b'], 'b')).toEqual(singleGrid('b'));
  });

  it('drops agents that are gone', () => {
    expect(reconcileGrid(['b', 'a', 'c', 'd'], ['a', 'b', 'd'], 'a')).toEqual(['b', 'a', 'b', 'd']);
  });

  it('brings in an active agent the grid does not show yet', () => {
    expect(reconcileGrid(['a', 'b', 'a', 'b'], ['a', 'b', 'c'], 'c')).toEqual(['c', 'b', 'c', 'b']);
  });

  it('is the active terminal alone when nothing stored is left', () => {
    expect(reconcileGrid(['a', 'b', 'a', 'b'], ['c'], 'c')).toEqual(singleGrid('c'));
  });
});

describe('terminalGrid – panes', () => {
  it('one pane for a single terminal', () => {
    expect(paneLayout(singleGrid('a'))).toEqual([
      { agentId: 'a', row: 1, col: 1, rowSpan: 2, colSpan: 2 },
    ]);
  });

  it('side by side', () => {
    expect(paneLayout(['a', 'b', 'a', 'b'])).toEqual([
      { agentId: 'a', row: 1, col: 1, rowSpan: 2, colSpan: 1 },
      { agentId: 'b', row: 1, col: 2, rowSpan: 2, colSpan: 1 },
    ]);
  });

  it('a half above two quarters', () => {
    expect(paneLayout(['a', 'a', 'c', 'd'])).toEqual([
      { agentId: 'a', row: 1, col: 1, rowSpan: 1, colSpan: 2 },
      { agentId: 'c', row: 2, col: 1, rowSpan: 1, colSpan: 1 },
      { agentId: 'd', row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ]);
  });
});

describe('terminalGrid – where the pointer is', () => {
  const at = (fx: number, fy: number): DropZone | null =>
    zoneAt(RECT.left + fx * RECT.width, RECT.top + fy * RECT.height, RECT);

  it('reads the sides', () => {
    expect(at(0.1, 0.5)).toBe('left');
    expect(at(0.9, 0.5)).toBe('right');
    expect(at(0.5, 0.1)).toBe('top');
    expect(at(0.5, 0.9)).toBe('bottom');
  });

  it('reads the corners before the sides', () => {
    expect(at(0.1, 0.1)).toBe('tl');
    expect(at(0.9, 0.1)).toBe('tr');
    expect(at(0.1, 0.9)).toBe('bl');
    expect(at(0.9, 0.9)).toBe('br');
  });

  it('reads the middle', () => {
    expect(at(0.5, 0.5)).toBe('center');
  });

  it('is nothing outside the area or for an area without a size', () => {
    expect(at(-0.01, 0.5)).toBeNull();
    expect(at(0.5, 1.01)).toBeNull();
    expect(zoneAt(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it('describes the space a zone would take', () => {
    expect(zoneRect('left')).toEqual({ left: 0, top: 0, width: 0.5, height: 1 });
    expect(zoneRect('br')).toEqual({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 });
    expect(zoneRect('center')).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});
