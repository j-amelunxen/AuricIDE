import { describe, expect, it, vi } from 'vitest';
import { memoizeByInput } from './memoizeByInput';

describe('memoizeByInput', () => {
  it('computes once per input reference and returns the same result for it', () => {
    const compute = vi.fn((items: number[]) => items.filter((n) => n > 1));
    const select = memoizeByInput(compute);
    const input = [1, 2, 3];

    const first = select(input);
    const second = select(input);

    expect(second).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the input is a different reference', () => {
    const compute = vi.fn((items: number[]) => items.length);
    const select = memoizeByInput(compute);

    select([1]);
    expect(select([1, 2])).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
