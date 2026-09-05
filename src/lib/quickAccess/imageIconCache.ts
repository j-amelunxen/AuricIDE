import { readImageAsDataUri } from '@/lib/tauri/projectIcons';
import { createAsyncDedupeCache } from './asyncDedupeCache';

/**
 * Path → data URI, or null once a path is known to be unreadable.
 *
 * Quick Access renders every starred tile at once, several of them may share
 * an icon, and Mission Control remounts whenever you leave a tab. Without this
 * the same favicon would be read from disk over and over for a picture that
 * never changes within a session. A negative entry is cached too — a deleted
 * favicon should cost one failed read, not one per render.
 */
const iconCache = createAsyncDedupeCache<string>();

export function getCachedImageIcon(path: string): string | null | undefined {
  return iconCache.get(path);
}

export function loadImageIcon(path: string): Promise<string | null> {
  return iconCache.load(path, () => readImageAsDataUri(path));
}

/** Forgets one path, or everything. Used by tests and after picking a new icon. */
export function clearImageIconCache(path?: string): void {
  iconCache.clear(path);
}
