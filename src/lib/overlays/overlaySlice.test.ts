import { beforeEach, describe, expect, it } from 'vitest';
import { createOverlaySlice, type OverlaySlice } from './overlaySlice';

function createTestStore() {
  let state: OverlaySlice;
  const setState = (
    partial: Partial<OverlaySlice> | ((s: OverlaySlice) => Partial<OverlaySlice>)
  ) => {
    const updates = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...updates };
  };
  const getState = () => state;
  state = createOverlaySlice(setState as never, getState as never, {} as never);
  return {
    get current() {
      return state;
    },
  };
}

describe('overlaySlice', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('starts empty', () => {
    expect(store.current.overlayStack.layers).toEqual([]);
    expect(store.current.ownsEscape('plan')).toBe(false);
  });

  it('gives Escape to the last pushed layer', () => {
    store.current.pushOverlay({ id: 'plan', kind: 'tool' });
    store.current.pushOverlay({ id: 'ticket-create', kind: 'tool' });

    expect(store.current.ownsEscape('plan')).toBe(false);
    expect(store.current.ownsEscape('ticket-create')).toBe(true);
  });

  it('returns Escape to the parent after the child is removed', () => {
    store.current.pushOverlay({ id: 'plan', kind: 'tool' });
    store.current.pushOverlay({ id: 'ticket-create', kind: 'tool' });
    store.current.removeOverlay('ticket-create');

    expect(store.current.ownsEscape('plan')).toBe(true);
    expect(store.current.ownsEscape('ticket-create')).toBe(false);
  });

  it('lets a confirm steal Escape from the tool beneath', () => {
    store.current.pushOverlay({ id: 'plan', kind: 'tool' });
    store.current.pushOverlay({ id: 'confirm', kind: 'confirm' });

    expect(store.current.ownsEscape('plan')).toBe(false);
    expect(store.current.ownsEscape('confirm')).toBe(true);
  });

  it('replace swaps the top tool', () => {
    store.current.pushOverlay({ id: 'goals', kind: 'tool' });
    store.current.replaceOverlay({ id: 'goal-lines', kind: 'tool' });

    expect(store.current.overlayStack.layers.map((l) => l.id)).toEqual(['goal-lines']);
    expect(store.current.ownsEscape('goals')).toBe(false);
    expect(store.current.ownsEscape('goal-lines')).toBe(true);
  });
});
