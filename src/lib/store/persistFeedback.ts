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
  state: unknown,
  what: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const showToast =
      typeof state === 'object' && state !== null && 'showToast' in state
        ? (state as Partial<ToastSlice>).showToast
        : undefined;
    showToast?.(`Could not save ${what}: ${describe(error)}`, 'error');
    throw error;
  }
}

/**
 * Fires a save without awaiting it. The store already reports failures, so the
 * only job here is to keep a rejection from surfacing as an unhandled one —
 * and to survive a caller that hands back something other than a promise,
 * which would otherwise crash the click handler that started the save.
 */
export function persistInBackground(save: Promise<unknown> | unknown): void {
  void Promise.resolve(save).catch(() => {});
}

/** Awaits a save, swallowing the failure the store already reported. */
export async function persistQuietly(save: Promise<unknown> | unknown): Promise<void> {
  await Promise.resolve(save).catch(() => {});
}
