import { describe, expect, it } from 'vitest';
import { capList } from './listCap';

describe('capList', () => {
  it('returns the same array when it fits', () => {
    const items = [1, 2, 3];
    expect(capList(items, 3)).toEqual({ shown: items, hidden: 0 });
  });

  it('cuts at the limit and says how many are left out', () => {
    const items = Array.from({ length: 51_435 }, (_, i) => i);
    const { shown, hidden } = capList(items, 500);
    expect(shown).toHaveLength(500);
    expect(hidden).toBe(50_935);
  });
});
