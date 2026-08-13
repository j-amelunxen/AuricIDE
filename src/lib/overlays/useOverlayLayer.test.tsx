import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { useOverlayLayer } from './useOverlayLayer';

function fireEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('useOverlayLayer', () => {
  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('registers while active and unregisters when it is not', () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useOverlayLayer({ id: 'plan', kind: 'tool', active }),
      { initialProps: { active: true } }
    );

    expect(result.current.ownsEscape).toBe(true);
    expect(useStore.getState().overlayStack.layers.map((l) => l.id)).toEqual(['plan']);

    rerender({ active: false });
    expect(result.current.ownsEscape).toBe(false);
    expect(useStore.getState().overlayStack.layers).toEqual([]);
  });

  it('only the top layer hears Escape', () => {
    const onPlan = vi.fn();
    const onChild = vi.fn();

    renderHook(() => useOverlayLayer({ id: 'plan', kind: 'tool', active: true, onEscape: onPlan }));
    renderHook(() =>
      useOverlayLayer({
        id: 'ticket-create',
        kind: 'tool',
        active: true,
        onEscape: onChild,
      })
    );

    act(() => {
      fireEscape();
    });

    expect(onChild).toHaveBeenCalledTimes(1);
    expect(onPlan).not.toHaveBeenCalled();
  });

  it('three Escapes peel confirm, then child, then parent', () => {
    const onPlan = vi.fn();
    const onChild = vi.fn();
    const onConfirm = vi.fn();

    renderHook(() => useOverlayLayer({ id: 'plan', kind: 'tool', active: true, onEscape: onPlan }));
    renderHook(() =>
      useOverlayLayer({ id: 'ticket-create', kind: 'tool', active: true, onEscape: onChild })
    );
    const confirm = renderHook(() =>
      useOverlayLayer({ id: 'confirm', kind: 'confirm', active: true, onEscape: onConfirm })
    );

    act(() => {
      fireEscape();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onChild).not.toHaveBeenCalled();
    expect(onPlan).not.toHaveBeenCalled();

    confirm.unmount();
    act(() => {
      fireEscape();
    });
    expect(onChild).toHaveBeenCalledTimes(1);
    expect(onPlan).not.toHaveBeenCalled();
  });

  it('unmounting the top layer returns Escape to the parent', () => {
    const onPlan = vi.fn();
    renderHook(() => useOverlayLayer({ id: 'plan', kind: 'tool', active: true, onEscape: onPlan }));
    const child = renderHook(() =>
      useOverlayLayer({ id: 'ticket-create', kind: 'tool', active: true })
    );

    child.unmount();

    act(() => {
      fireEscape();
    });

    expect(onPlan).toHaveBeenCalledTimes(1);
  });
});
