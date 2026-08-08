import { describe, expect, it, vi } from 'vitest';
import { persistInBackground, persistQuietly, withPersistFeedback } from './persistFeedback';

describe('withPersistFeedback', () => {
  it('returns the value and stays quiet on success', async () => {
    const showToast = vi.fn();
    await expect(withPersistFeedback({ showToast }, 'goals', async () => 42)).resolves.toBe(42);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('announces a failure as an error toast', async () => {
    const showToast = vi.fn();
    await expect(
      withPersistFeedback({ showToast }, 'goals', async () => {
        throw new Error('database is locked');
      })
    ).rejects.toThrow('database is locked');
    expect(showToast).toHaveBeenCalledWith('Could not save goals: database is locked', 'error');
  });

  it('names what could not be saved', async () => {
    const showToast = vi.fn();
    await withPersistFeedback({ showToast }, 'requirements', async () => {
      throw new Error('nope');
    }).catch(() => {});
    expect(showToast.mock.calls[0][0]).toContain('requirements');
  });

  it('reports a thrown string as-is', async () => {
    const showToast = vi.fn();
    await withPersistFeedback({ showToast }, 'goals', async () => {
      throw 'disk full';
    }).catch(() => {});
    expect(showToast).toHaveBeenCalledWith('Could not save goals: disk full', 'error');
  });

  it('falls back to a generic reason for a valueless failure', async () => {
    const showToast = vi.fn();
    await withPersistFeedback({ showToast }, 'goals', async () => {
      throw new Error('');
    }).catch(() => {});
    expect(showToast).toHaveBeenCalledWith('Could not save goals: unknown error', 'error');
  });

  it('still rejects when no toast channel exists', async () => {
    await expect(
      withPersistFeedback({}, 'goals', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('persistInBackground', () => {
  it('swallows a rejection so it never surfaces as unhandled', async () => {
    expect(() => persistInBackground(Promise.reject(new Error('locked')))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('survives a save action that returns nothing', () => {
    expect(() => persistInBackground(undefined)).not.toThrow();
  });
});

describe('persistQuietly', () => {
  it('resolves even when the save failed', async () => {
    await expect(persistQuietly(Promise.reject(new Error('locked')))).resolves.toBeUndefined();
  });

  it('survives a save action that returns nothing', async () => {
    await expect(persistQuietly(undefined)).resolves.toBeUndefined();
  });

  it('waits for the save to finish', async () => {
    let done = false;
    await persistQuietly(
      (async () => {
        await Promise.resolve();
        done = true;
      })()
    );
    expect(done).toBe(true);
  });
});
