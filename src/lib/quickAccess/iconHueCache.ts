import { dominantIconHue } from './iconColor';

/**
 * Path → the hue its mark is built from, or null once a mark is known to have
 * none (greyscale, or a file that would not decode).
 *
 * Same reasoning as the image cache next door: every starred tile renders at
 * once and Mission Control remounts on every tab change, so without this the
 * same favicon would be decoded and sampled on each pass for an answer that
 * cannot change within a session. Negative answers are cached too — a
 * greyscale logo should cost one decode, not one per render.
 */
const cache = new Map<string, number | null>();
const inFlight = new Map<string, Promise<number | null>>();

/**
 * Sampling resolution. Small on purpose: a dominant hue survives downsampling,
 * and 32×32 is ~1k pixels to walk instead of the 65k a 256px favicon would
 * cost — per tile, on a path that runs while the cockpit is painting.
 */
const SAMPLE_SIZE = 32;

export function getCachedIconHue(path: string): number | null | undefined {
  return cache.get(path);
}

function sample(dataUri: string): Promise<number | null> {
  return new Promise((resolve) => {
    // Canvas and Image are browser-only; unit tests and SSR get the neutral
    // surface rather than an exception.
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }

    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(dominantIconHue(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
      } catch {
        // A tainted or zero-sized canvas is not worth a broken tile.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUri;
  });
}

/** The hue for an already-loaded icon, decoding it at most once per session. */
export function loadIconHue(path: string, dataUri: string): Promise<number | null> {
  const cached = cache.get(path);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = sample(dataUri)
    .then((hue) => {
      cache.set(path, hue);
      return hue;
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

/**
 * Forgets one path, or everything. Used by tests. Picking a different icon
 * changes the path and so lands on a fresh entry by itself; only overwriting
 * the bytes at a path already sampled this session would need this in
 * production, which nothing currently does.
 */
export function clearIconHueCache(path?: string): void {
  if (path === undefined) {
    cache.clear();
    inFlight.clear();
    return;
  }
  cache.delete(path);
  inFlight.delete(path);
}
