import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import type { useIDEState } from '../useIDEState';
import { useLiveIDEState } from './liveIDEState';

type PageState = ReturnType<typeof useIDEState>;
const page = (fields: Record<string, unknown>) => fields as unknown as PageState;

describe('useLiveIDEState', () => {
  afterEach(() => useStore.setState({ agents: [], cursorPos: { line: 1, col: 1 } }));

  it('keeps one identity across renders while reading the newest page state', () => {
    const { result, rerender } = renderHook(({ state }) => useLiveIDEState(state), {
      initialProps: { state: page({ rootPath: '/one' }) },
    });
    const first = result.current;

    rerender({ state: page({ rootPath: '/two' }) });

    expect(result.current).toBe(first);
    expect(first.rootPath).toBe('/two');
  });

  it('reads the hot store fields from the store at the moment of the read', () => {
    const { result } = renderHook(() => useLiveIDEState(page({})));

    useStore.setState({ cursorPos: { line: 9, col: 2 } });

    expect(result.current.cursorPos).toEqual({ line: 9, col: 2 });
  });

  it('prefers a hot field the passed state carries itself', () => {
    const own = [{ id: 'mine' }];
    const { result } = renderHook(() => useLiveIDEState(page({ agents: own })));

    expect(result.current.agents).toBe(own);
  });

  it('does not reach into the store for fields that are not hot', () => {
    useStore.setState({ rootPath: '/from-store' });
    const { result } = renderHook(() => useLiveIDEState(page({})));

    expect(result.current.rootPath).toBeUndefined();
    useStore.setState({ rootPath: null });
  });
});
