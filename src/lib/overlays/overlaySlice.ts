import type { StateCreator } from 'zustand';
import {
  hasLayer,
  ownsEscape as stackOwnsEscape,
  pop,
  push,
  remove,
  replace,
  type OverlayEntry,
  type OverlayStack,
} from './stack';

export interface OverlaySlice {
  overlayStack: OverlayStack;
  pushOverlay: (entry: OverlayEntry) => void;
  popOverlay: () => void;
  replaceOverlay: (entry: OverlayEntry) => void;
  removeOverlay: (id: string) => void;
  ownsEscape: (id: string) => boolean;
}

export const createOverlaySlice: StateCreator<OverlaySlice> = (set, get) => ({
  overlayStack: { layers: [] },

  pushOverlay: (entry) => {
    const stack = get().overlayStack;
    if (hasLayer(stack, entry.id)) {
      return;
    }
    set({ overlayStack: push(stack, entry) });
  },

  popOverlay: () => set({ overlayStack: pop(get().overlayStack) }),

  replaceOverlay: (entry) => set({ overlayStack: replace(get().overlayStack, entry) }),

  removeOverlay: (id) => set({ overlayStack: remove(get().overlayStack, id) }),

  ownsEscape: (id) => stackOwnsEscape(get().overlayStack, id),
});
