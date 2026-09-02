import { describe, expect, it } from 'vitest';
import { applyVisibleOrder, getListDropPlace, moveId } from './customOrder';

type Row = { id: string; sortOrder: number; label?: string };

function rows(...ids: string[]): Row[] {
  return ids.map((id, i) => ({ id, sortOrder: i }));
}

describe('moveId', () => {
  it('moves an id before another', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('moves an id after another', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 'b', 'after')).toEqual(['b', 'a', 'c']);
  });

  it('is a no-op when the dragged id is the drop target', () => {
    expect(moveId(['a', 'b', 'c'], 'b', 'b', 'before')).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 'b', 'after')).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op when either id is missing', () => {
    expect(moveId(['a', 'b'], 'z', 'a', 'before')).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'a', 'z', 'after')).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const ids = ['a', 'b', 'c'];
    moveId(ids, 'c', 'a', 'before');
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('getListDropPlace', () => {
  const rect = { top: 100, height: 40 };

  it('treats the top half as before and the bottom half as after', () => {
    expect(getListDropPlace(100, rect)).toBe('before');
    expect(getListDropPlace(119, rect)).toBe('before');
    expect(getListDropPlace(120, rect)).toBe('after');
    expect(getListDropPlace(139, rect)).toBe('after');
  });
});

describe('applyVisibleOrder', () => {
  it('compacts the full list to 0..n-1 in the given order', () => {
    const items = rows('a', 'b', 'c');
    const next = applyVisibleOrder(items, ['c', 'a', 'b']);
    expect(next.map((item) => [item.id, item.sortOrder])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 0],
    ]);
  });

  it('reorders only the visible subset and leaves others in their slots', () => {
    const items = rows('a1', 'b1', 'a2', 'b2');
    const next = applyVisibleOrder(items, ['a2', 'a1']);
    // a1 and a2 occupied slots 0 and 2; they swap those slots. b's stay.
    expect(next.map((item) => [item.id, item.sortOrder])).toEqual([
      ['a1', 2],
      ['b1', 1],
      ['a2', 0],
      ['b2', 3],
    ]);
  });

  it('makes duplicate sortOrders unique after the first reorder', () => {
    const items: Row[] = [
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 0 },
      { id: 'c', sortOrder: 1 },
    ];
    const next = applyVisibleOrder(items, ['c', 'b', 'a']);
    const orders = next.map((item) => item.sortOrder);
    expect(new Set(orders).size).toBe(3);
    expect(next.find((item) => item.id === 'c')?.sortOrder).toBe(0);
    expect(next.find((item) => item.id === 'b')?.sortOrder).toBe(1);
    expect(next.find((item) => item.id === 'a')?.sortOrder).toBe(2);
  });

  it('is a no-op for an unknown id, a duplicate, or a single item', () => {
    const items = rows('a', 'b');
    expect(applyVisibleOrder(items, ['a', 'z'])).toBe(items);
    expect(applyVisibleOrder(items, ['a', 'a'])).toBe(items);
    expect(applyVisibleOrder(items, ['a'])).toBe(items);
    expect(applyVisibleOrder(items, [])).toBe(items);
  });

  it('does not mutate the input items', () => {
    const items = rows('a', 'b');
    applyVisibleOrder(items, ['b', 'a']);
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1]);
  });
});
