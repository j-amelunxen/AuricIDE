import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeFit, safeFit } from './fit';

let notify: () => void = () => {};
const disconnect = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  disconnect.mockClear();
});

describe('safeFit', () => {
  it('survives a container without size', () => {
    expect(() =>
      safeFit({
        fit: () => {
          throw new Error('no dimensions');
        },
      })
    ).not.toThrow();
  });
});

describe('observeFit', () => {
  it('fits once after a burst of resizes settles', () => {
    const fitAddon = { fit: vi.fn() };
    observeFit({} as Element, fitAddon);

    notify();
    notify();
    notify();
    expect(fitAddon.fit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fitAddon.fit).toHaveBeenCalledTimes(1);
  });

  it('fits nothing after it is stopped', () => {
    const fitAddon = { fit: vi.fn() };
    const stop = observeFit({} as Element, fitAddon);

    notify();
    stop();
    vi.advanceTimersByTime(50);

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
