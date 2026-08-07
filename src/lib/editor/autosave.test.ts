import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave, AUTOSAVE_DELAY_MS } from './autosave';

/** Resolve pending microtasks so awaited writes settle. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not write before the debounce elapses', () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);

    expect(write).not.toHaveBeenCalled();
  });

  it('writes once the typing pause is long enough', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('/a.md', 'hello');
  });

  it('collapses a burst of keystrokes into a single write of the final text', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'h');
    vi.advanceTimersByTime(50);
    autosave.schedule('/a.md', 'he');
    vi.advanceTimersByTime(50);
    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('/a.md', 'hello');
  });

  it('never runs two writes for the same file at once', async () => {
    let inFlight = 0;
    let peak = 0;
    let release: (() => void) | null = null;
    const write = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => {
        release = () => {
          inFlight--;
          resolve();
        };
      });
    });
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'first');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    autosave.schedule('/a.md', 'second');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(peak).toBe(1);
    release!();
    await settle();
    expect(peak).toBe(1);
  });

  it('lands the newest text last even when an earlier write is still running', async () => {
    const order: string[] = [];
    const resolvers: (() => void)[] = [];
    const write = vi.fn(async (_path: string, content: string) => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
      order.push(content);
    });
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'old');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    // Typed while the first write is still in flight.
    autosave.schedule('/a.md', 'new');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    resolvers[0]();
    await settle();
    resolvers[1]?.();
    await settle();

    expect(order).toEqual(['old', 'new']);
  });

  it('coalesces edits made during an in-flight write into one follow-up', async () => {
    const resolvers: (() => void)[] = [];
    const write = vi.fn(async () => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
    });
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'one');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    autosave.schedule('/a.md', 'two');
    autosave.schedule('/a.md', 'three');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    resolvers[0]();
    await settle();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('/a.md', 'three');
  });

  it('keeps files independent', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'a');
    autosave.schedule('/b.md', 'b');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(write).toHaveBeenCalledWith('/a.md', 'a');
    expect(write).toHaveBeenCalledWith('/b.md', 'b');
  });

  it('reports a saved file so the dirty marker can clear', async () => {
    const onSaved = vi.fn();
    const autosave = createAutosave({ write: async () => {}, onSaved });

    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(onSaved).toHaveBeenCalledWith('/a.md', 'hello');
  });

  it('does not report saved when newer text is already queued', async () => {
    const onSaved = vi.fn();
    const resolvers: (() => void)[] = [];
    const autosave = createAutosave({
      write: async () => {
        await new Promise<void>((resolve) => resolvers.push(resolve));
      },
      onSaved,
    });

    autosave.schedule('/a.md', 'one');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    autosave.schedule('/a.md', 'two');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    resolvers[0]();
    await settle();

    expect(onSaved).not.toHaveBeenCalledWith('/a.md', 'one');
  });

  it('reports a failed write instead of losing it', async () => {
    const onError = vi.fn();
    const autosave = createAutosave({
      write: async () => {
        throw new Error('disk full');
      },
      onError,
    });

    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(onError).toHaveBeenCalledWith('/a.md', expect.any(Error));
  });

  it('does not report a failed write as saved', async () => {
    const onSaved = vi.fn();
    const autosave = createAutosave({
      write: async () => {
        throw new Error('disk full');
      },
      onSaved,
      onError: vi.fn(),
    });

    autosave.schedule('/a.md', 'hello');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps saving after a failure', async () => {
    let attempt = 0;
    const write = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('transient');
    });
    const autosave = createAutosave({ write, onError: vi.fn() });

    autosave.schedule('/a.md', 'one');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();
    autosave.schedule('/a.md', 'two');
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    await settle();

    expect(write).toHaveBeenCalledTimes(2);
  });

  it('flush writes pending text immediately', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'hello');
    await autosave.flush();

    expect(write).toHaveBeenCalledWith('/a.md', 'hello');
  });

  it('flush resolves once the write has actually landed', async () => {
    let done = false;
    const autosave = createAutosave({
      write: async () => {
        await Promise.resolve();
        done = true;
      },
    });

    autosave.schedule('/a.md', 'hello');
    await autosave.flush();

    expect(done).toBe(true);
  });

  it('flush is a no-op with nothing pending', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });
    await expect(autosave.flush()).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it('flush never rejects on a failed write', async () => {
    const onError = vi.fn();
    const autosave = createAutosave({
      write: async () => {
        throw new Error('disk full');
      },
      onError,
    });

    autosave.schedule('/a.md', 'hello');
    await expect(autosave.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });

  it('cancel drops pending text without writing it', async () => {
    const write = vi.fn(async () => {});
    const autosave = createAutosave({ write });

    autosave.schedule('/a.md', 'hello');
    autosave.cancel();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 4);
    await settle();

    expect(write).not.toHaveBeenCalled();
  });
});
