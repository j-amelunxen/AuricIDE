import { describe, expect, it } from 'vitest';
import {
  RECENTLY_CREATED_WINDOW_MS,
  collectCreatedAt,
  hasRecentlyCreatedFile,
  isRecentlyCreated,
  nextRecentlyCreatedExpiry,
} from './recentlyCreated';

const NOW = 1_700_000_000_000;

describe('isRecentlyCreated', () => {
  it('is true for a file created just now', () => {
    expect(isRecentlyCreated(NOW, NOW)).toBe(true);
  });

  it('is true just inside the 5-minute window', () => {
    expect(isRecentlyCreated(NOW - RECENTLY_CREATED_WINDOW_MS + 1, NOW)).toBe(true);
  });

  it('is false at exactly 5 minutes', () => {
    expect(isRecentlyCreated(NOW - RECENTLY_CREATED_WINDOW_MS, NOW)).toBe(false);
  });

  it('is false well after the window', () => {
    expect(isRecentlyCreated(NOW - RECENTLY_CREATED_WINDOW_MS - 1, NOW)).toBe(false);
  });

  it('is false when createdAt is missing', () => {
    expect(isRecentlyCreated(undefined, NOW)).toBe(false);
  });

  it('is false for a timestamp in the future', () => {
    expect(isRecentlyCreated(NOW + 1_000, NOW)).toBe(false);
  });
});

describe('collectCreatedAt', () => {
  it('walks collapsed children and newest-file timestamps too', () => {
    expect(
      collectCreatedAt([
        { createdAt: 1, newestFileCreatedAt: 4 },
        { children: [{ createdAt: 2 }, { children: [{ createdAt: 3 }] }] },
      ])
    ).toEqual([1, 4, undefined, undefined, 2, undefined, undefined, undefined, 3, undefined]);
  });
});

describe('hasRecentlyCreatedFile', () => {
  it('is true for a recently created file', () => {
    expect(hasRecentlyCreatedFile({ isDirectory: false, createdAt: NOW - 1_000 }, NOW)).toBe(true);
  });

  it('is false for an old file', () => {
    expect(
      hasRecentlyCreatedFile({ isDirectory: false, createdAt: NOW - 10 * 60 * 1000 }, NOW)
    ).toBe(false);
  });

  it('is false for an empty folder even if the folder itself is new', () => {
    expect(
      hasRecentlyCreatedFile({ isDirectory: true, createdAt: NOW - 1_000, children: [] }, NOW)
    ).toBe(false);
  });

  it('is true when a direct child file is recent', () => {
    expect(
      hasRecentlyCreatedFile(
        {
          isDirectory: true,
          children: [{ isDirectory: false, createdAt: NOW - 1_000 }],
        },
        NOW
      )
    ).toBe(true);
  });

  it('is true when a nested descendant file is recent', () => {
    expect(
      hasRecentlyCreatedFile(
        {
          isDirectory: true,
          children: [
            {
              isDirectory: true,
              children: [
                { isDirectory: false, createdAt: NOW - 6 * 60 * 1000 },
                { isDirectory: false, createdAt: NOW - 20_000 },
              ],
            },
          ],
        },
        NOW
      )
    ).toBe(true);
  });

  it('is false when every descendant file is old', () => {
    expect(
      hasRecentlyCreatedFile(
        {
          isDirectory: true,
          children: [
            {
              isDirectory: true,
              children: [{ isDirectory: false, createdAt: NOW - 10 * 60 * 1000 }],
            },
          ],
        },
        NOW
      )
    ).toBe(false);
  });

  it('is true for a folder whose newest descendant file is recent, even without children loaded', () => {
    expect(
      hasRecentlyCreatedFile(
        { isDirectory: true, children: [], newestFileCreatedAt: NOW - 15_000 },
        NOW
      )
    ).toBe(true);
  });
});

describe('nextRecentlyCreatedExpiry', () => {
  it('returns the soonest expiry still in the window', () => {
    const older = NOW - 4 * 60 * 1000;
    const newer = NOW - 60 * 1000;
    expect(nextRecentlyCreatedExpiry([newer, older, undefined], NOW)).toBe(
      older + RECENTLY_CREATED_WINDOW_MS
    );
  });

  it('returns null when nothing is still recent', () => {
    expect(
      nextRecentlyCreatedExpiry([NOW - RECENTLY_CREATED_WINDOW_MS, undefined], NOW)
    ).toBeNull();
  });
});
