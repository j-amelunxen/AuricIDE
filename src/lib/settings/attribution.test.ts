import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_STORAGE_KEY,
  loadShowAttribution,
  saveShowAttribution,
  useAttribution,
} from './attribution';

describe('attribution setting', () => {
  afterEach(() => {
    localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
  });

  it('defaults to OFF when nothing is stored', () => {
    expect(loadShowAttribution()).toBe(false);
  });

  it('reads a stored ON value', () => {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, 'true');
    expect(loadShowAttribution()).toBe(true);
  });

  it('persists the value on save', () => {
    saveShowAttribution(true);
    expect(loadShowAttribution()).toBe(true);
    saveShowAttribution(false);
    expect(loadShowAttribution()).toBe(false);
  });

  it('useAttribution exposes the current value and a setter that notifies subscribers', () => {
    const { result } = renderHook(() => useAttribution());
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(loadShowAttribution()).toBe(true);
  });
});
