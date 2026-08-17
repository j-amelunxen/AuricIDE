import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleForMs, installUserActivityTracker } from './userActivity';

describe('userActivity', () => {
  // Every install adds fresh listeners; leaving a prior test's attached would
  // let it keep writing the shared module state during a later test.
  let uninstall: (() => void) | null = null;
  const install = (target: Window | Document) => {
    uninstall = installUserActivityTracker(target);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.useRealTimers();
  });

  it('counts app start as activity: idle time grows from install, not from zero', () => {
    install(window);
    vi.setSystemTime(5_000);
    expect(idleForMs()).toBe(5_000);
  });

  it('resets on a keydown', () => {
    install(window);
    vi.setSystemTime(5_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.setSystemTime(5_600);
    expect(idleForMs()).toBe(600);
  });

  it('resets on a pointerdown', () => {
    install(window);
    vi.setSystemTime(5_000);
    window.dispatchEvent(new Event('pointerdown'));
    vi.setSystemTime(5_400);
    expect(idleForMs()).toBe(400);
  });

  it('resets on a wheel event', () => {
    install(window);
    vi.setSystemTime(5_000);
    window.dispatchEvent(new Event('wheel'));
    vi.setSystemTime(5_300);
    expect(idleForMs()).toBe(300);
  });

  it('throttles writes: a second input within 1s of the last one does not move the reference', () => {
    install(window);
    vi.setSystemTime(1_000);
    window.dispatchEvent(new KeyboardEvent('keydown')); // recorded, reference = 1000
    vi.setSystemTime(1_500);
    window.dispatchEvent(new KeyboardEvent('keydown')); // < 1s since last write, ignored
    vi.setSystemTime(1_600);
    // If the second event had been recorded, idle would read 100, not 600.
    expect(idleForMs()).toBe(600);
  });

  it('records an input again once the throttle window has passed', () => {
    install(window);
    vi.setSystemTime(1_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.setSystemTime(2_100); // past the 1s throttle
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.setSystemTime(2_200);
    expect(idleForMs()).toBe(100);
  });

  it('stops tracking once the returned cleanup runs', () => {
    install(window);
    vi.setSystemTime(1_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    uninstall?.();
    uninstall = null;
    vi.setSystemTime(2_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    vi.setSystemTime(2_500);
    // The second event fired after uninstall and must not have been recorded.
    expect(idleForMs()).toBe(1_500);
  });

  it('accepts an explicit now for idleForMs', () => {
    install(window);
    expect(idleForMs(9_000)).toBe(9_000);
  });
});
