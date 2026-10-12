/**
 * "Request changes" opens the spawn dialog with the open comments as a
 * checklist, and the comments count as sent only once an agent actually runs
 * with them: the dialog can still be cancelled. The dialog reports nothing back
 * to whoever opened it, so this watches the store instead. The answer is read
 * when the dialog closes, because the dialog awaits the spawn before closing.
 *
 * A launch is an agent that appeared while the dialog was open and whose task
 * carries the checklist we put into the dialog. Any other agent starting at the
 * same moment (the conductor, a schedule) does not mark the comments sent, and
 * neither does a launch where the person deleted the checklist from the prompt.
 */

export interface SpawnWatchAgent {
  id: string;
  /** The instruction the agent was started with. */
  currentTask?: string;
}

export interface SpawnWatchState {
  spawnDialogOpen: boolean;
  agents: readonly SpawnWatchAgent[];
}

export interface SpawnWatchStore {
  getState: () => SpawnWatchState;
  subscribe: (listener: (state: SpawnWatchState) => void) => () => void;
}

/**
 * Calls `onLaunched` at most once, for a new agent whose task contains
 * `checklist`. Returns a function that stops watching.
 */
export function watchReviewSpawn(
  store: SpawnWatchStore,
  checklist: string,
  onLaunched: () => void
): () => void {
  const before = new Set(store.getState().agents.map((agent) => agent.id));
  const needle = checklist.trim();
  if (!store.getState().spawnDialogOpen || !needle) return () => {};
  let stopped = false;
  const unsubscribe = store.subscribe((state) => {
    if (stopped || state.spawnDialogOpen) return;
    stop();
    const launched = state.agents.some(
      (agent) => !before.has(agent.id) && (agent.currentTask ?? '').includes(needle)
    );
    if (launched) onLaunched();
  });
  function stop() {
    stopped = true;
    unsubscribe();
  }
  return stop;
}
