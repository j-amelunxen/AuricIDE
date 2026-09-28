import { describe, expect, it } from 'vitest';
import { planRows } from './virtualRows';

const base = { count: 1000, rowHeight: 20, scrollTop: 0, viewportHeight: 200, overscan: 5 };

const rows = (plan: ReturnType<typeof planRows>) =>
  plan.flatMap((p) => (p.kind === 'row' ? [p.index] : []));
const height = (plan: ReturnType<typeof planRows>, rowHeight = 20) =>
  plan.reduce((sum, p) => sum + (p.kind === 'row' ? rowHeight : p.height), 0);

describe('planRows', () => {
  it('renders the visible window plus overscan and one gap for the rest', () => {
    const plan = planRows({ ...base, pinned: [] });

    expect(rows(plan)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(plan.at(-1)).toEqual({ kind: 'gap', start: 15, height: 985 * 20 });
  });

  it('keeps the full scroll height whatever is rendered', () => {
    for (const scrollTop of [0, 3333, 19_800, 50_000]) {
      expect(height(planRows({ ...base, scrollTop, pinned: [3, 700] }))).toBe(1000 * 20);
    }
  });

  it('follows the scroll position', () => {
    const plan = planRows({ ...base, scrollTop: 400 * 20, pinned: [] });

    expect(rows(plan)).toEqual(Array.from({ length: 20 }, (_, i) => 395 + i));
    expect(plan[0]).toEqual({ kind: 'gap', start: 0, height: 395 * 20 });
  });

  it('renders pinned rows in their own place, far outside the window', () => {
    const plan = planRows({ ...base, pinned: [500, 999, 2] });

    expect(rows(plan)).toContain(500);
    expect(rows(plan)).toContain(999);
    // Rows come out in list order, so DOM order stays tree order.
    expect(rows(plan)).toEqual([...rows(plan)].sort((a, b) => a - b));
  });

  it('ignores pinned indices that no longer exist', () => {
    expect(rows(planRows({ ...base, count: 3, pinned: [7, -1] }))).toEqual([0, 1, 2]);
  });

  it('clamps a scroll position past the end to the last rows', () => {
    const plan = planRows({ ...base, scrollTop: 1_000_000, pinned: [] });

    expect(rows(plan).at(-1)).toBe(999);
    expect(height(plan)).toBe(1000 * 20);
  });

  it('renders nothing for an empty list', () => {
    expect(planRows({ ...base, count: 0, pinned: [] })).toEqual([]);
  });
});
