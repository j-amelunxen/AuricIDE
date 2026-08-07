import { describe, expect, it, vi } from 'vitest';
import { describeLoadError, IDLE_LOAD_STATE, trackLoad } from './loadState';

describe('trackLoad', () => {
  it('marks loading before the work starts', async () => {
    const set = vi.fn();
    let seenAtStart: unknown;
    await trackLoad(set, async () => {
      seenAtStart = set.mock.calls[0][0];
    });
    expect(seenAtStart).toEqual({ loading: true, error: null });
  });

  it('clears loading after success', async () => {
    const set = vi.fn();
    await trackLoad(set, async () => {});
    expect(set).toHaveBeenLastCalledWith({ loading: false, error: null });
  });

  it('records why a load failed', async () => {
    const set = vi.fn();
    await trackLoad(set, async () => {
      throw new Error('database is locked');
    });
    expect(set).toHaveBeenLastCalledWith({ loading: false, error: 'database is locked' });
  });

  it('does not rethrow — nobody awaits an opened surface', async () => {
    await expect(
      trackLoad(vi.fn(), async () => {
        throw new Error('boom');
      })
    ).resolves.toBeUndefined();
  });

  it('clears a previous error when a retry starts', async () => {
    const set = vi.fn();
    await trackLoad(set, async () => {
      throw new Error('first');
    });
    set.mockClear();
    await trackLoad(set, async () => {});
    expect(set.mock.calls[0][0]).toEqual({ loading: true, error: null });
  });
});

describe('describeLoadError', () => {
  it('passes a string reason through', () => {
    expect(describeLoadError('no such table')).toBe('no such table');
  });

  it('uses an error message', () => {
    expect(describeLoadError(new Error('locked'))).toBe('locked');
  });

  it('falls back for a valueless failure', () => {
    expect(describeLoadError(new Error(''))).toBe('unknown error');
    expect(describeLoadError(undefined)).toBe('unknown error');
  });
});

describe('IDLE_LOAD_STATE', () => {
  it('is neither loading nor failed', () => {
    expect(IDLE_LOAD_STATE).toEqual({ loading: false, error: null });
  });
});
