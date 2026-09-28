import { describe, expect, it, vi } from 'vitest';
import { createSharedPromiseCache } from './sharedPromiseCache';

describe('createSharedPromiseCache', () => {
  it('shares an in-flight call across concurrent callers with the same key', async () => {
    const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
    let release: (value: string) => void = () => {};
    const factory = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = cache.get('k', factory);
    const second = cache.get('k', factory);
    expect(factory).toHaveBeenCalledTimes(1);

    release('value');
    await expect(first).resolves.toBe('value');
    await expect(second).resolves.toBe('value');
  });

  it('shares the settled result with a caller arriving within the TTL', async () => {
    const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
    const factory = vi.fn(async () => 'value');

    await cache.get('k', factory);
    await cache.get('k', factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('calls the factory again once the TTL has expired', async () => {
    vi.useFakeTimers();
    try {
      const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
      const factory = vi.fn(async () => 'value');

      await cache.get('k', factory);
      vi.advanceTimersByTime(1_001);
      await cache.get('k', factory);

      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps different keys independent', async () => {
    const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
    const factory = vi.fn(async () => 'value');

    await cache.get('a', factory);
    await cache.get('b', factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not surface an unhandled rejection through its own bookkeeping when the factory rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
      await expect(cache.get('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
      // Give the microtask queue a tick — an unhandled derived promise from
      // the cache's own settlement bookkeeping would surface here.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('forgets every cached entry on clear', async () => {
    const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
    const factory = vi.fn(async () => 'value');

    await cache.get('k', factory);
    cache.clear();
    await cache.get('k', factory);

    expect(factory).toHaveBeenCalledTimes(2);
  });
  // Every agent finish asks under a key that holds its own output extract and
  // task, so no key comes back. Expired entries used to stay for the session.
  it('drops expired entries instead of keeping every key for the session', async () => {
    vi.useFakeTimers();
    try {
      const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
      await cache.get('finish-1', async () => 'a');
      await cache.get('finish-2', async () => 'b');
      vi.advanceTimersByTime(1_001);
      await cache.get('finish-3', async () => 'c');
      expect(cache.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never drops an entry that is still in flight', async () => {
    vi.useFakeTimers();
    try {
      const cache = createSharedPromiseCache<string>({ ttlMs: 1_000 });
      const pending = new Promise<string>(() => {});
      void cache.get('slow', () => pending);
      vi.advanceTimersByTime(5_000);
      await cache.get('other', async () => 'x');
      expect(cache.get('slow', async () => 'fresh')).toBe(pending);
    } finally {
      vi.useRealTimers();
    }
  });
});
