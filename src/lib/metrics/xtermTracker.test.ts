import { describe, it, expect, beforeEach } from 'vitest';
import { xtermMounted, xtermUnmounted, getXtermCount, resetXtermCount } from './xtermTracker';

describe('xtermTracker', () => {
  beforeEach(() => {
    resetXtermCount();
  });

  it('starts at 0', () => {
    expect(getXtermCount()).toBe(0);
  });

  it('increments on mount', () => {
    xtermMounted();
    expect(getXtermCount()).toBe(1);
    xtermMounted();
    expect(getXtermCount()).toBe(2);
  });

  it('decrements on unmount', () => {
    xtermMounted();
    xtermMounted();
    xtermUnmounted();
    expect(getXtermCount()).toBe(1);
  });

  it('does not go below 0', () => {
    xtermUnmounted();
    expect(getXtermCount()).toBe(0);
  });
});
