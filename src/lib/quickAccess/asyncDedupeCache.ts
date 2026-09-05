export interface AsyncDedupeCache<T> {
  get: (key: string) => T | null | undefined;
  load: (key: string, fetcher: () => Promise<T | null>) => Promise<T | null>;
  clear: (key?: string) => void;
}

/**
 * Creates an in-memory asynchronous cache that deduplicates concurrent in-flight
 * requests for the same key and caches negative (null) answers to prevent repeated
 * failed lookups.
 */
export function createAsyncDedupeCache<T>(): AsyncDedupeCache<T> {
  const cache = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();

  return {
    get(key: string): T | null | undefined {
      return cache.get(key);
    },

    load(key: string, fetcher: () => Promise<T | null>): Promise<T | null> {
      const cached = cache.get(key);
      if (cached !== undefined) return Promise.resolve(cached);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const request = fetcher()
        .then((result) => {
          cache.set(key, result);
          return result;
        })
        .catch(() => {
          cache.set(key, null);
          return null;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    },

    clear(key?: string): void {
      if (key === undefined) {
        cache.clear();
        inFlight.clear();
        return;
      }
      cache.delete(key);
      inFlight.delete(key);
    },
  };
}
