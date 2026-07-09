import type { StateCreator } from 'zustand';

export type ToastVariant = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

export interface ToastSlice {
  toasts: Toast[];
  /** Queue a transient notification. Returns its id so it can be dismissed early. */
  showToast: (message: string, variant?: ToastVariant) => number;
  dismissToast: (id: number) => void;
}

// Module-level counter keeps ids unique without depending on Date.now().
let toastCounter = 0;

export const createToastSlice: StateCreator<ToastSlice> = (set) => ({
  toasts: [],
  showToast: (message, variant = 'info') => {
    const id = ++toastCounter;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
});
