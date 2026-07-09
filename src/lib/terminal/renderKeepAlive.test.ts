import { describe, expect, it } from 'vitest';
import { createRenderKeepAlive } from './renderKeepAlive';

/** Deterministic rAF + clock harness. */
function harness() {
  let time = 0;
  const queue: Array<() => void> = [];
  const raf = (cb: () => void) => {
    queue.push(cb);
    return queue.length; // 1-based id
  };
  const caf = (id: number) => {
    queue[id - 1] = () => {};
  };
  const now = () => time;
  const tick = (ms: number) => {
    time += ms;
    const pending = queue.splice(0);
    pending.forEach((cb) => cb());
  };
  return { raf, caf, now, tick, pendingFrames: () => queue.length };
}

describe('createRenderKeepAlive', () => {
  it('schedules a frame on nudge', () => {
    const h = harness();
    const ka = createRenderKeepAlive(h.raf, h.caf, h.now, 400);
    expect(h.pendingFrames()).toBe(0);
    ka.nudge();
    expect(h.pendingFrames()).toBe(1);
  });

  it('keeps pumping frames while within the keep-alive window', () => {
    const h = harness();
    const ka = createRenderKeepAlive(h.raf, h.caf, h.now, 400);
    ka.nudge();
    h.tick(100); // still within window → reschedules
    expect(h.pendingFrames()).toBe(1);
    h.tick(100);
    expect(h.pendingFrames()).toBe(1);
  });

  it('stops pumping once the window elapses', () => {
    const h = harness();
    const ka = createRenderKeepAlive(h.raf, h.caf, h.now, 400);
    ka.nudge();
    h.tick(500); // past deadline → no reschedule
    expect(h.pendingFrames()).toBe(0);
  });

  it('a later nudge extends the window', () => {
    const h = harness();
    const ka = createRenderKeepAlive(h.raf, h.caf, h.now, 400);
    ka.nudge();
    h.tick(300);
    ka.nudge(); // extend deadline to 300+400
    h.tick(300); // now at 600, still < 700
    expect(h.pendingFrames()).toBe(1);
  });

  it('stop() cancels the loop', () => {
    const h = harness();
    const ka = createRenderKeepAlive(h.raf, h.caf, h.now, 400);
    ka.nudge();
    ka.stop();
    h.tick(100);
    expect(h.pendingFrames()).toBe(0);
  });
});
