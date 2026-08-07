/**
 * Load status for a project data set.
 *
 * Without it, an empty list is ambiguous in the worst possible way: "you have
 * no goals", "your goals have not arrived yet" and "your goals could not be
 * read" all render as the same confident emptiness. The first is information,
 * the other two are lies — and the third is the one that makes a user think
 * their project state is gone.
 */
export interface LoadState {
  loading: boolean;
  /** Reason the last load failed; null when it succeeded or never ran. */
  error: string | null;
}

export const IDLE_LOAD_STATE: LoadState = { loading: false, error: null };

export function describeLoadError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return 'unknown error';
}

/**
 * Runs a load and reports its status through `set`. Failures are recorded, not
 * thrown: a load is triggered by opening a surface, and nobody is awaiting it.
 */
export async function trackLoad(
  set: (state: LoadState) => void,
  run: () => Promise<void>
): Promise<void> {
  set({ loading: true, error: null });
  try {
    await run();
    set({ loading: false, error: null });
  } catch (error) {
    set({ loading: false, error: describeLoadError(error) });
  }
}
