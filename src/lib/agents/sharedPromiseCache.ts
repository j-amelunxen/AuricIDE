/** A cache of in-flight-or-recently-settled promises, keyed by string. */
export interface SharedPromiseCache<T> {
  /**
   * Returns the cached promise for `key` if one is in flight or settled
   * within the TTL; otherwise calls `factory` and caches its result.
   */
  get(key: string, factory: () => Promise<T>): Promise<T>;
  /** Forgets every cached entry. */
  clear(): void;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  /** Null while in flight; stamped the moment it settles, so a caller past the TTL asks fresh. */
  settledAt: number | null;
}

/**
 * One promise per distinct key, shared by every caller that asks for it
 * while it is in flight or within `ttlMs` after it settles. Built for the
 * case where two independent call sites reach for the same expensive result
 * (e.g. an LLM call) in the same tick — without sharing, one logical
 * operation becomes two identical round trips.
 */
export function createSharedPromiseCache<T>(options: { ttlMs: number }): SharedPromiseCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  function get(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = entries.get(key);
    if (cached && (cached.settledAt === null || now - cached.settledAt < options.ttlMs)) {
      return cached.promise;
    }

    const promise = factory();
    const entry: CacheEntry<T> = { promise, settledAt: null };
    entries.set(key, entry);
    // A separate derived promise, not the one callers await — it must not
    // surface as an unhandled rejection when the factory fails.
    promise
      .finally(() => {
        entry.settledAt = Date.now();
      })
      .catch(() => {});
    return promise;
  }

  function clear(): void {
    entries.clear();
  }

  return { get, clear };
}
