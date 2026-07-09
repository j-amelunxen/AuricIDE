import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand';
import { createToastSlice, type ToastSlice } from './toastSlice';

function makeStore() {
  return createStore<ToastSlice>((set, get, api) => createToastSlice(set, get, api));
}

describe('toastSlice', () => {
  it('starts with no toasts', () => {
    expect(makeStore().getState().toasts).toEqual([]);
  });

  it('adds a toast with the given message and variant', () => {
    const store = makeStore();
    store.getState().showToast('Something broke', 'error');
    const [toast] = store.getState().toasts;
    expect(toast.message).toBe('Something broke');
    expect(toast.variant).toBe('error');
  });

  it('defaults the variant to info', () => {
    const store = makeStore();
    store.getState().showToast('Heads up');
    expect(store.getState().toasts[0].variant).toBe('info');
  });

  it('assigns unique ids and returns the new id', () => {
    const store = makeStore();
    const a = store.getState().showToast('a');
    const b = store.getState().showToast('b');
    expect(a).not.toBe(b);
    expect(store.getState().toasts.map((t) => t.id)).toEqual([a, b]);
  });

  it('dismisses a toast by id', () => {
    const store = makeStore();
    const id = store.getState().showToast('bye');
    store.getState().dismissToast(id);
    expect(store.getState().toasts).toEqual([]);
  });
});
