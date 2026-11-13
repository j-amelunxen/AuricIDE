import { create } from 'zustand';
import { createStoreState } from './createStore';
import type { StoreState } from './types';

export type { StoreState } from './types';

export const useStore = create<StoreState>()(createStoreState);

// Dev-only: expose the store for debugging and browser-mode testing.
// Dead code in production builds (NODE_ENV check is inlined at build time).
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__AURIC_STORE__ = useStore;
}
