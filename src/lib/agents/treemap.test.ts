import { describe, expect, it } from 'vitest';
import { applyGap, layoutFleetTreemap, squarify, type Weighted } from './treemap';

function area(r: { w: number; h: number }): number {
  return r.w * r.h;
}

function assertPacked(
  items: { id: string; x: number; y: number; w: number; h: number }[],
  parent: { x: number; y: number; w: number; h: number }
) {
  for (const item of items) {
    expect(item.w).toBeGreaterThan(0);
    expect(item.h).toBeGreaterThan(0);
    expect(item.x).toBeGreaterThanOrEqual(parent.x - 1e-9);
    expect(item.y).toBeGreaterThanOrEqual(parent.y - 1e-9);
    expect(item.x + item.w).toBeLessThanOrEqual(parent.x + parent.w + 1e-9);
    expect(item.y + item.h).toBeLessThanOrEqual(parent.y + parent.h + 1e-9);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(overlapX <= 1e-9 || overlapY <= 1e-9).toBe(true);
    }
  }
}

describe('squarify', () => {
  it('returns nothing for an empty list', () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([]);
  });

  it('returns nothing when the parent has no area', () => {
    expect(squarify([{ id: 'a', weight: 1 }], 0, 0, 0, 100)).toEqual([]);
    expect(squarify([{ id: 'a', weight: 1 }], 0, 0, 100, 0)).toEqual([]);
  });

  it('drops zero-weight items', () => {
    expect(squarify([{ id: 'a', weight: 0 }], 0, 0, 100, 100)).toEqual([]);
  });

  it('gives a single item the whole rectangle', () => {
    expect(squarify([{ id: 'solo', weight: 3 }], 10, 20, 80, 40)).toEqual([
      { id: 'solo', x: 10, y: 20, w: 80, h: 40 },
    ]);
  });

  it('splits two equal weights into two halves that fill the parent', () => {
    const items: Weighted[] = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ];
    const rects = squarify(items, 0, 0, 100, 100);
    expect(rects).toHaveLength(2);
    assertPacked(rects, { x: 0, y: 0, w: 100, h: 100 });
    expect(area(rects[0])).toBeCloseTo(5000, 5);
    expect(area(rects[1])).toBeCloseTo(5000, 5);
  });

  it('gives a 4:1 weight split roughly four times the area', () => {
    const rects = squarify(
      [
        { id: 'big', weight: 4 },
        { id: 'small', weight: 1 },
      ],
      0,
      0,
      100,
      50
    );
    const byId = Object.fromEntries(rects.map((r) => [r.id, r]));
    expect(area(byId.big) / area(byId.small)).toBeCloseTo(4, 5);
    assertPacked(rects, { x: 0, y: 0, w: 100, h: 50 });
  });

  it('keeps input order: the first item is laid out first', () => {
    // Attention-sorted groups must not be reordered by weight — the urgent
    // project belongs in the first strip, not shuffled to wherever a descending
    // sort would put the biggest cluster.
    const rects = squarify(
      [
        { id: 'urgent', weight: 1 },
        { id: 'busy', weight: 4 },
      ],
      0,
      0,
      100,
      100
    );
    expect(rects[0].id).toBe('urgent');
    expect(rects[1].id).toBe('busy');
  });

  it('fills a wide parent without leftover gaps (areas sum to the parent)', () => {
    const rects = squarify(
      [
        { id: 'a', weight: 2 },
        { id: 'b', weight: 1 },
        { id: 'c', weight: 1 },
        { id: 'd', weight: 3 },
      ],
      0,
      0,
      400,
      200
    );
    const total = rects.reduce((s, r) => s + area(r), 0);
    expect(total).toBeCloseTo(80_000, 3);
    assertPacked(rects, { x: 0, y: 0, w: 400, h: 200 });
  });
});

describe('applyGap', () => {
  it('shrinks a rect equally on every side and keeps it centred', () => {
    expect(applyGap({ id: 'a', x: 0, y: 0, w: 100, h: 40 }, 8)).toEqual({
      id: 'a',
      x: 4,
      y: 4,
      w: 92,
      h: 32,
    });
  });

  it('does not invert a rect that is smaller than the gap', () => {
    const tiny = applyGap({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, 8);
    expect(tiny.w).toBeGreaterThan(0);
    expect(tiny.h).toBeGreaterThan(0);
  });
});

describe('layoutFleetTreemap', () => {
  it('returns nothing when there are no groups with agents', () => {
    expect(layoutFleetTreemap([], 800, 400)).toEqual([]);
    expect(layoutFleetTreemap([{ id: 'idle', agents: [] }], 800, 400)).toEqual([]);
  });

  it('scales project clusters by agent count', () => {
    const layout = layoutFleetTreemap(
      [
        { id: 'customers', agents: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }] },
        { id: 'website', agents: [{ id: 'w1' }] },
      ],
      800,
      400,
      { gap: 0 }
    );
    const customers = layout.find((g) => g.id === 'customers')!;
    const website = layout.find((g) => g.id === 'website')!;
    expect(area(customers) / area(website)).toBeCloseTo(4, 1);
  });

  it('nests each agent inside its project, below the header', () => {
    const layout = layoutFleetTreemap(
      [
        {
          id: 'acme',
          agents: [{ id: 'a1' }, { id: 'a2' }],
        },
      ],
      400,
      300,
      { headerH: 28 }
    );
    expect(layout).toHaveLength(1);
    const group = layout[0];
    expect(group.headerH).toBe(28);
    expect(group.agents).toHaveLength(2);
    for (const agent of group.agents) {
      expect(agent.groupId).toBe('acme');
      expect(agent.y).toBeGreaterThanOrEqual(group.y + group.headerH - 1e-9);
      expect(agent.y + agent.h).toBeLessThanOrEqual(group.y + group.h + 1e-9);
      expect(agent.x).toBeGreaterThanOrEqual(group.x - 1e-9);
      expect(agent.x + agent.w).toBeLessThanOrEqual(group.x + group.w + 1e-9);
    }
    assertPacked(group.agents, {
      x: group.x,
      y: group.y + group.headerH,
      w: group.w,
      h: group.h - group.headerH,
    });
  });

  it('gives every agent in a project the same weight', () => {
    const layout = layoutFleetTreemap(
      [{ id: 'acme', agents: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] }],
      300,
      300,
      { gap: 0, headerH: 0 }
    );
    const areas = layout[0].agents.map(area);
    expect(areas[0]).toBeCloseTo(areas[1], 3);
    expect(areas[1]).toBeCloseTo(areas[2], 3);
  });

  it('keeps group order so the first project is laid out first', () => {
    const layout = layoutFleetTreemap(
      [
        { id: 'urgent', agents: [{ id: 'u1' }] },
        { id: 'busy', agents: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] },
      ],
      400,
      400
    );
    expect(layout[0].id).toBe('urgent');
  });
});
