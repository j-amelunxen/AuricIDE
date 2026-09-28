import { describe, expect, it, vi } from 'vitest';
import { createOutputBatcher, type OutputBatch } from './outputBatcher';

/** Manual frame + timer queues, so every flush is triggered by the test. */
function harness() {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const batches: OutputBatch[] = [];
  let clock = 1000;
  const batcher = createOutputBatcher((batch) => batches.push(batch), {
    now: () => clock++,
    requestFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    setTimer: (cb) => {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const run = (queue: Map<number, () => void>) => {
    const pending = Array.from(queue.values());
    queue.clear();
    pending.forEach((cb) => cb());
  };
  return {
    batcher,
    batches,
    frame: () => run(frames),
    timeout: () => run(timers),
    scheduled: () => frames.size + timers.size,
  };
}

describe('createOutputBatcher', () => {
  it('hands a burst of chunks from several agents over in one batch per frame', () => {
    const h = harness();
    h.batcher.push('a', 'one');
    h.batcher.push('b', 'x');
    h.batcher.push('a', 'two');
    expect(h.batches).toHaveLength(0);

    h.frame();

    expect(h.batches).toEqual([
      [
        ['a', ['one', 'two'], [1000, 1002]],
        ['b', ['x'], [1001]],
      ],
    ]);
  });

  it('flushes on the fallback timer when frames are parked (hidden window)', () => {
    const h = harness();
    h.batcher.push('a', 'one');
    h.timeout();
    expect(h.batches).toEqual([[['a', ['one'], [1000]]]]);
    // The frame that lost the race must not flush an empty batch.
    h.frame();
    expect(h.batches).toHaveLength(1);
    expect(h.scheduled()).toBe(0);
  });

  it('flush() delivers pending output synchronously, before a status change is applied', () => {
    const h = harness();
    h.batcher.push('a', 'last words');
    h.batcher.flush();
    expect(h.batches).toEqual([[['a', ['last words'], [1000]]]]);
    expect(h.scheduled()).toBe(0);
  });

  it('flush() with nothing pending does nothing', () => {
    const onBatch = vi.fn();
    const batcher = createOutputBatcher(onBatch, {
      requestFrame: () => 1,
      cancelFrame: () => {},
      setTimer: () => 1,
      clearTimer: () => {},
    });
    batcher.flush();
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('schedules one flush per burst, not one per chunk', () => {
    const h = harness();
    for (let i = 0; i < 50; i++) h.batcher.push('a', String(i));
    // one frame + one fallback timer
    expect(h.scheduled()).toBe(2);
    h.frame();
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0][0][1]).toHaveLength(50);
  });
});

describe('createOutputBatcher – hidden window', () => {
  it('hands each chunk over at once while hidden, deferring nothing', () => {
    const batches: OutputBatch[] = [];
    let hidden = true;
    const requestFrame = vi.fn(() => 1);
    const setTimer = vi.fn(() => 2);
    const batcher = createOutputBatcher((batch) => batches.push(batch), {
      requestFrame,
      cancelFrame: () => {},
      setTimer,
      clearTimer: () => {},
      now: () => 5,
      isHidden: () => hidden,
    });
    batcher.push('a', 'Do you want to proceed?');
    expect(batches).toEqual([[['a', ['Do you want to proceed?'], [5]]]]);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(setTimer).not.toHaveBeenCalled();

    hidden = false;
    batcher.push('a', 'next');
    expect(batches).toHaveLength(1);
  });
});
