import { readImageAsDataUri } from '@/lib/tauri/projectIcons';

/**
 * Path → data URI, or null once a path is known to be unreadable.
 *
 * Quick Access renders every starred tile at once, several of them may share
 * an icon, and Mission Control remounts whenever you leave a tab. Without this
 * the same favicon would be read from disk over and over for a picture that
 * never changes within a session. A negative entry is cached too — a deleted
 * favicon should cost one failed read, not one per render.
 */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

export function getCachedImageIcon(path: string): string | null | undefined {
  return cache.get(path);
}

export function loadImageIcon(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = readImageAsDataUri(path)
    .then((dataUri) => {
      cache.set(path, dataUri);
      return dataUri;
    })
    .catch(() => {
      cache.set(path, null);
      return null;
    })
    .finally(() => {
      inFlight.delete(path);
    });

  inFlight.set(path, request);
  return request;
}

/** Forgets one path, or everything. Used by tests and after picking a new icon. */
export function clearImageIconCache(path?: string): void {
  if (path === undefined) {
    cache.clear();
    inFlight.clear();
    return;
  }
  cache.delete(path);
  inFlight.delete(path);
}
