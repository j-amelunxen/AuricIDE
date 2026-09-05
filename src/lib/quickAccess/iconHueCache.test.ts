import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCachedIconHue, loadIconHue, clearIconHueCache } from './iconHueCache';

describe('iconHueCache', () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    clearIconHueCache();
  });

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it('returns undefined for uncached path', () => {
    expect(getCachedIconHue('/path/to/icon.png')).toBeUndefined();
  });

  it('resolves hue and stores it in cache', async () => {
    // Mock Image to fire onload
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          this.onerror?.();
        }, 10);
      }
    }
    // @ts-expect-error mock Image
    globalThis.Image = MockImage;

    const result = await loadIconHue('/path/to/icon.png', 'data:image/png;base64,...');
    expect(result).toBeNull();
    expect(getCachedIconHue('/path/to/icon.png')).toBe(null);
  });

  it('deduplicates simultaneous in-flight requests', async () => {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          this.onerror?.();
        }, 10);
      }
    }
    // @ts-expect-error mock Image
    globalThis.Image = MockImage;

    const promise1 = loadIconHue('/dup/icon.png', 'data:image/png;base64,...');
    const promise2 = loadIconHue('/dup/icon.png', 'data:image/png;base64,...');
    expect(promise1).toBe(promise2);
    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe(res2);
  });

  it('clears specific path or all paths', async () => {
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        setTimeout(() => {
          this.onerror?.();
        }, 10);
      }
    }
    // @ts-expect-error mock Image
    globalThis.Image = MockImage;

    await loadIconHue('/a.png', 'data:image/png;base64,...');
    await loadIconHue('/b.png', 'data:image/png;base64,...');

    clearIconHueCache('/a.png');
    expect(getCachedIconHue('/a.png')).toBeUndefined();
    expect(getCachedIconHue('/b.png')).not.toBeUndefined();

    clearIconHueCache();
    expect(getCachedIconHue('/b.png')).toBeUndefined();
  });
});
