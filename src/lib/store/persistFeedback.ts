import type { ToastSlice } from './toastSlice';

function describe(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return 'unknown error';
}

/**
 * Wraps a persistence action so a failure is never silent.
 *
 * A save that quietly does nothing looks exactly like a save that worked: the
 * user closes the window and loses the work. The error still propagates —
 * callers must be free to keep a modal open or leave the dirty flag set — but
 * it always announces itself first.
 */
export async function withPersistFeedback<T>(
  state: Partial<ToastSlice>,
  what: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    state.showToast?.(`Could not save ${what}: ${describe(error)}`, 'error');
    throw error;
  }
}
