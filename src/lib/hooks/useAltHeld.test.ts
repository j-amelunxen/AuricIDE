import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAltHeld } from './useAltHeld';

const press = (type: 'keydown' | 'keyup', altKey: boolean) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { key: 'Alt', altKey }));
  });

describe('useAltHeld', () => {
  it('is false until Alt goes down, and false again when it comes up', () => {
    const { result } = renderHook(() => useAltHeld());
    expect(result.current).toBe(false);
    press('keydown', true);
    expect(result.current).toBe(true);
    press('keyup', false);
    expect(result.current).toBe(false);
  });

  it('lets go when the window loses focus, because the keyup never arrives', () => {
    const { result } = renderHook(() => useAltHeld());
    press('keydown', true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBe(false);
  });
});
