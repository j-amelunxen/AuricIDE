import { describe, expect, it } from 'vitest';
import { changedFields, reuseRows, sameValue } from './stableRefs';

describe('sameValue', () => {
  it('treats structurally equal plain values as the same', () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe('reuseRows', () => {
  it('returns the previous array when every row is unchanged', () => {
    const prev = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ];
    const next = structuredClone(prev);
    expect(reuseRows(prev, next)).toBe(prev);
  });

  it('keeps unchanged rows by reference and takes the changed one', () => {
    const prev = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ];
    const next = [
      { id: 'a', n: 1 },
      { id: 'b', n: 3 },
    ];
    const out = reuseRows(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
  });

  it('follows the order of the fresh rows', () => {
    const prev = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ];
    const next = [
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
    ];
    const out = reuseRows(prev, next);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
    expect(out[0]).toBe(prev[1]);
  });

  it('sees a removed row as a change', () => {
    const prev = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ];
    const out = reuseRows(prev, [{ id: 'a', n: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(prev[0]);
  });
});

describe('changedFields', () => {
  it('is empty when a reload brings nothing new', () => {
    const current = { rows: [{ id: 'a', n: 1 }], flag: false, note: 'x' };
    expect(changedFields(current, structuredClone(current))).toEqual({});
  });

  it('carries only the fields that differ, with unchanged rows reused', () => {
    const current = {
      rows: [
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ],
      flag: false,
    };
    const patch = changedFields(current, {
      rows: [
        { id: 'a', n: 1 },
        { id: 'b', n: 9 },
      ],
      flag: false,
    });
    expect(Object.keys(patch)).toEqual(['rows']);
    expect(patch.rows?.[0]).toBe(current.rows[0]);
  });

  it('compares arrays without ids as whole values', () => {
    const current = { names: ['a', 'b'] };
    expect(changedFields(current, { names: ['a', 'b'] })).toEqual({});
    expect(changedFields(current, { names: ['a'] })).toEqual({ names: ['a'] });
  });
});
