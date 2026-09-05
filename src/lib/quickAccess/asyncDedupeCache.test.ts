import { describe, expect, it, vi } from 'vitest';
import { createAsyncDedupeCache } from './asyncDedupeCache';

describe('createAsyncDedupeCache', () => {
  it('returns undefined when key has not been loaded', () => {
    const cache = createAsyncDedupeCache<string>();
    expect(cache.get('foo')).toBeUndefined();
  });

  it('loads and caches result on success', async () => {
    const cache = createAsyncDedupeCache<string>();
    const fetcher = vi.fn().mockResolvedValue('bar');

    const result = await cache.load('foo', fetcher);
    expect(result).toBe('bar');
    expect(cache.get('foo')).toBe('bar');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Second call uses cache
    const second = await cache.load('foo', fetcher);
    expect(second).toBe('bar');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('deduplicates in-flight requests', async () => {
    const cache = createAsyncDedupeCache<number>();
    let resolveFirst: (v: number) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveFirst = resolve;
        })
    );

    const promise1 = cache.load('num', fetcher);
    const promise2 = cache.load('num', fetcher);

    resolveFirst(42);
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).toBe(42);
    expect(res2).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches null on error', async () => {
    const cache = createAsyncDedupeCache<string>();
    const fetcher = vi.fn().mockRejectedValue(new Error('fail'));

    const result = await cache.load('err', fetcher);
    expect(result).toBeNull();
    expect(cache.get('err')).toBeNull();

    // Second call returns cached null without invoking fetcher again
    const second = await cache.load('err', fetcher);
    expect(second).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('clears specific key or all keys', async () => {
    const cache = createAsyncDedupeCache<string>();
    await cache.load('a', () => Promise.resolve('valA'));
    await cache.load('b', () => Promise.resolve('valB'));

    cache.clear('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('valB');

    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });
});
