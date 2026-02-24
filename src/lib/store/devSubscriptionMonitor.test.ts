import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDevSubscriptionMonitor } from './devSubscriptionMonitor';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('devSubscriptionMonitor', () => {
  it('does not warn for normal subscription rates', () => {
    const monitor = createDevSubscriptionMonitor({ maxFiresPerSecond: 50 });

    // Fire 10 times — well under threshold
    for (let i = 0; i < 10; i++) {
      monitor.record('allFilePaths');
    }

    vi.advanceTimersByTime(1100);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when a property exceeds the threshold', () => {
    const monitor = createDevSubscriptionMonitor({ maxFiresPerSecond: 20 });

    // Fire 25 times in one second — over threshold
    for (let i = 0; i < 25; i++) {
      monitor.record('diagnostics');
    }

    vi.advanceTimersByTime(1100);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('diagnostics'),
      expect.any(Number)
    );
  });

  it('resets counters after each interval', () => {
    const monitor = createDevSubscriptionMonitor({ maxFiresPerSecond: 10 });

    for (let i = 0; i < 5; i++) {
      monitor.record('lintConfig');
    }

    vi.advanceTimersByTime(1100);
    expect(console.warn).not.toHaveBeenCalled();

    // After reset, fire again — should not accumulate
    for (let i = 0; i < 5; i++) {
      monitor.record('lintConfig');
    }

    vi.advanceTimersByTime(1100);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('tracks multiple properties independently', () => {
    const monitor = createDevSubscriptionMonitor({ maxFiresPerSecond: 10 });

    for (let i = 0; i < 15; i++) {
      monitor.record('propA');
    }
    for (let i = 0; i < 5; i++) {
      monitor.record('propB');
    }

    vi.advanceTimersByTime(1100);
    // Only propA should warn
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('propA'), expect.any(Number));
  });

  it('can be destroyed to stop monitoring', () => {
    const monitor = createDevSubscriptionMonitor({ maxFiresPerSecond: 5 });

    for (let i = 0; i < 10; i++) {
      monitor.record('x');
    }

    monitor.destroy();
    vi.advanceTimersByTime(1100);
    // Should not warn after destroy
    expect(console.warn).not.toHaveBeenCalled();
  });
});
