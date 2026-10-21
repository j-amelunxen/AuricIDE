import type { StateCreator } from 'zustand';

export type ToastVariant = 'error' | 'success' | 'info';

/** One button on a toast, for the follow-up the message points at. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

export interface ToastSlice {
  toasts: Toast[];
  /** Queue a transient notification. Returns its id so it can be dismissed early. */
  showToast: (message: string, variant?: ToastVariant, action?: ToastAction) => number;
  dismissToast: (id: number) => void;
}

// Module-level counter keeps ids unique without depending on Date.now().
let toastCounter = 0;

export const createToastSlice: StateCreator<ToastSlice> = (set) => ({
  toasts: [],
  showToast: (message, variant = 'info', action) => {
    const id = ++toastCounter;
    set((state) => ({
      toasts: [...state.toasts, { id, message, variant, ...(action && { action }) }],
    }));
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
});
