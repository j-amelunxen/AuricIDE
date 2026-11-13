import { create } from 'zustand';
import { createStoreState } from './createStore';
import type { StoreState } from './types';

/** Complete fresh state, with explicit overrides for dependencies under test. */
export function createTestStore(overrides: Partial<StoreState> = {}) {
  return create<StoreState>()((...args) => ({ ...createStoreState(...args), ...overrides }));
}
