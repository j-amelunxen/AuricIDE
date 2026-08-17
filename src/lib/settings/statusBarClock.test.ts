import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STATUS_BAR_CLOCK_STORAGE_KEY,
  loadShowStatusBarClock,
  saveShowStatusBarClock,
  useStatusBarClock,
} from './statusBarClock';

describe('status bar clock setting', () => {
  afterEach(() => {
    localStorage.removeItem(STATUS_BAR_CLOCK_STORAGE_KEY);
  });

  it('defaults to ON when nothing is stored', () => {
    expect(loadShowStatusBarClock()).toBe(true);
  });

  it('reads a stored OFF value', () => {
    localStorage.setItem(STATUS_BAR_CLOCK_STORAGE_KEY, 'false');
    expect(loadShowStatusBarClock()).toBe(false);
  });

  it('persists the value on save', () => {
    saveShowStatusBarClock(false);
    expect(loadShowStatusBarClock()).toBe(false);
    saveShowStatusBarClock(true);
    expect(loadShowStatusBarClock()).toBe(true);
  });

  it('useStatusBarClock exposes the current value and a setter that notifies subscribers', () => {
    const { result } = renderHook(() => useStatusBarClock());
    expect(result.current[0]).toBe(true);

    act(() => {
      result.current[1](false);
    });

    expect(result.current[0]).toBe(false);
    expect(loadShowStatusBarClock()).toBe(false);
  });
});
